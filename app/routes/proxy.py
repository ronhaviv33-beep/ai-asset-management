import os
import json
import base64
import hashlib
import time
import uuid as _uuid_mod
import time as _time_mod

from fastapi import APIRouter, Depends, HTTPException, Request as FastAPIRequest
from fastapi.responses import JSONResponse, StreamingResponse
from slowapi import Limiter
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    AskRequest, AskResponse,
    ChatRequest, ChatResponse,
    SessionChatRequest,
)
from app.relationship_resolver import resolve_relationship
from app.relationships import upsert_relationship
from app import telemetry as tel
from app import budget as bud
from app import policy as pol
from app import sessions as sess
from app.scanner import scan
from app.client import (
    complete, chat_complete,
    proxy_chat_complete, proxy_chat_stream,
    get_client_for_org, CompletionResult as CR,
)
from app.auth import get_current_user, get_proxy_caller
from app.models import calculate_cost
from app.org_config import (
    get_org_config as _get_org_config,
    set_org_config as _set_org_config,
    PLATFORM_MODE as _PLATFORM_MODE,
    _VALID_GUARD_MODES as _VALID_MODES,
)

router = APIRouter()

import logging as _proxy_log
_log = _proxy_log.getLogger("ai_asset_mgmt")


def _classify_upstream_exc(exc: Exception, model: str) -> tuple[int, dict]:
    """
    Map an openai SDK (or generic) exception to an HTTP status and a structured
    error dict that safe to return to the caller.

    Returns (status_code, detail_dict) — always structured, never a plain string.
    """
    msg = str(exc)
    msg_lo = msg.lower()

    try:
        import openai as _oai
        if isinstance(exc, _oai.AuthenticationError):
            return 401, {
                "error": {
                    "type": "provider_auth_failed",
                    "provider": "openai",
                    "message": (
                        "The provider API key was rejected (authentication failed). "
                        "Re-enter the key in Settings → Organization AI Providers."
                    ),
                }
            }
        if isinstance(exc, _oai.PermissionDeniedError):
            return 403, {
                "error": {
                    "type": "provider_auth_failed",
                    "provider": "openai",
                    "message": (
                        "The provider key does not have permission to use this model. "
                        "Check the key's access level in the provider dashboard."
                    ),
                }
            }
        if isinstance(exc, _oai.NotFoundError):
            return 404, {
                "error": {
                    "type": "provider_model_error",
                    "provider": "openai",
                    "model": model,
                    "message": (
                        f"Model '{model}' was not found or is not available on this account. "
                        "Check the model name and your provider plan."
                    ),
                }
            }
        if isinstance(exc, _oai.RateLimitError):
            return 429, {
                "error": {
                    "type": "provider_upstream_error",
                    "provider": "openai",
                    "message": "Provider rate limit reached. Wait a moment and try again.",
                }
            }
        if isinstance(exc, _oai.BadRequestError):
            return 400, {
                "error": {
                    "type": "provider_upstream_error",
                    "provider": "openai",
                    "message": f"Provider rejected the request: {msg}",
                }
            }
        if isinstance(exc, (_oai.APITimeoutError, _oai.APIConnectionError)):
            return 504, {
                "error": {
                    "type": "provider_upstream_error",
                    "provider": "openai",
                    "message": "Could not reach the AI provider (timeout or connection error). Check network connectivity.",
                }
            }
        if isinstance(exc, _oai.APIStatusError):
            return 502, {
                "error": {
                    "type": "provider_upstream_error",
                    "provider": "openai",
                    "message": f"Provider returned an error (HTTP {exc.status_code}): {msg}",
                }
            }
    except ImportError:
        pass

    # Generic fallback — classify by string content
    if "auth" in msg_lo or "401" in msg_lo or "incorrect api key" in msg_lo or "invalid api key" in msg_lo:
        return 401, {
            "error": {
                "type": "provider_auth_failed",
                "message": "Provider authentication failed. Check the key in Settings → Organization AI Providers.",
            }
        }
    if "not found" in msg_lo or "404" in msg_lo:
        return 404, {
            "error": {
                "type": "provider_model_error",
                "model": model,
                "message": f"Model '{model}' not found. Check the model name.",
            }
        }
    if "timeout" in msg_lo or "connect" in msg_lo:
        return 504, {
            "error": {
                "type": "provider_upstream_error",
                "message": "Provider connection timed out.",
            }
        }

    return 502, {
        "error": {
            "type": "provider_upstream_error",
            "message": f"Upstream provider error: {msg}",
        }
    }


# ── In-memory cache: known (org_id, asset_key) pairs already in asset_registry ──
_known_assets: set[tuple[int, str]] = set()


# ── Asset taxonomy helpers ─────────────────────────────────────────────────────

_WORKFLOW_UA = {"n8n", "make.com", "zapier", "langgraph-workflow", "temporal"}
_COPILOT_UA  = {"copilot", "github-copilot", "salesforce-einstein", "ms-copilot"}
_SERVICE_NAMES = {"-service", "-api", "translation-", "classification-", "summariz"}


def _infer_asset_type(agent_name: str, user_agent: str) -> str:
    """Classify asset type from available signals."""
    ua  = (user_agent or "").lower()
    nm  = (agent_name  or "").lower()
    if any(x in ua for x in _WORKFLOW_UA) or any(x in nm for x in {"workflow", "pipeline", "orchestrat"}):
        return "workflow"
    if any(x in ua for x in _COPILOT_UA) or "copilot" in nm:
        return "copilot"
    if any(x in nm for x in _SERVICE_NAMES) or any(x in nm for x in {"-svc", "translate", "classif", "summar"}):
        return "service"
    if any(x in nm for x in {"chatbot", "chat-", "-chat", "assistant", "helpdesk"}):
        return "application"
    return "agent"


def _infer_capabilities(headers: dict) -> str:
    """Infer capabilities from request headers. Returns JSON array string."""
    import json as _json
    caps = {"inference"}  # every LLM call has inference capability
    h = {k.lower(): v.lower() for k, v in headers.items()}
    if h.get("x-mcp-tool") or h.get("x-mcp-server"):
        caps.add("tool_execution")
        caps.add("external_api")
    if h.get("x-agent-workflow") or h.get("x-workflow-provider"):
        caps.add("tool_execution")
    if any(x in str(h) for x in ["retriev", "vector", "rag", "search"]):
        caps.add("retrieval")
    return _json.dumps(sorted(caps))


def _discover_asset(
    db: Session, org_id: int, asset_key: str, agent_id_raw: str,
    team: str | None = None, environment: str | None = None,
    owner: str | None = None, source_hint: str | None = None,
    confidence_score: float = 0.95,
    evidence_data: dict | None = None,
    request_headers: dict | None = None,
) -> None:
    """Idempotent: insert a verified unassigned asset_registry row on first sight of an agent."""
    if (org_id, asset_key) in _known_assets:
        return
    import json as _json
    from app.models import AssetRegistry as _AssetRegistry

    _DSOURCE_MAP = {
        "sdk_runtime":     "sdk_runtime",
        "explicit_header": "gateway_telemetry",
        "api_key_scope":   "gateway_telemetry",
    }
    disc_source = _DSOURCE_MAP.get(source_hint or "", "gateway_runtime")

    try:
        existing = db.query(_AssetRegistry).filter(
            _AssetRegistry.organization_id == org_id,
            _AssetRegistry.asset_key == asset_key,
        ).first()
        if not existing:
            _ua = (request_headers or {}).get("user-agent", "") if request_headers else ""
            db.add(_AssetRegistry(
                organization_id=org_id,
                asset_key=asset_key,
                agent_id_raw=agent_id_raw,
                agent_name=agent_id_raw,
                team=team,
                environment=environment,
                owner=owner,
                status="unassigned",
                source=source_hint or "gateway_runtime",
                discovery_status="verified",
                discovery_source=disc_source,
                discovery_reason="Agent auto-discovered from runtime gateway traffic",
                evidence=_json.dumps(evidence_data or {}),
                confidence_score=round(confidence_score * 100, 1),
                asset_type=_infer_asset_type(agent_id_raw, _ua),
                capabilities=_infer_capabilities(request_headers or {}),
            ))
            db.commit()
        elif existing.discovery_source == "gateway_runtime" and disc_source != "gateway_runtime":
            # Agent was first seen without SDK headers; upgrade to the better classification now
            existing.discovery_source = disc_source
            if source_hint:
                existing.source = source_hint
            db.commit()
        _known_assets.add((org_id, asset_key))
    except Exception:
        db.rollback()


# ── Caller identity helpers ───────────────────────────────────────────────────

def _caller_org_id(caller) -> int | None:
    if caller is None:
        return None
    return caller.get("organization_id") if isinstance(caller, dict) else getattr(caller, "organization_id", None)


def _caller_team(caller) -> str | None:
    if caller is None:
        return None
    return caller.get("team") if isinstance(caller, dict) else getattr(caller, "team", None)


def _caller_name(caller) -> str | None:
    if caller is None:
        return None
    return caller.get("name") if isinstance(caller, dict) else getattr(caller, "name", None)


# ── Rate limiter ──────────────────────────────────────────────────────────────

def _proxy_rate_limit_key(request: FastAPIRequest) -> str:
    """Stable rate-limit key: API key hash, JWT sub, or client IP."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:]
        if token.startswith("gk-"):
            return "apikey:" + hashlib.sha256(token.encode()).hexdigest()[:24]
        try:
            parts = token.split(".")
            if len(parts) == 3:
                pad = 4 - len(parts[1]) % 4
                payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * pad))
                return f"user:{payload.get('sub', 'unknown')}"
        except Exception:
            pass
    return f"ip:{request.client.host if request.client else 'unknown'}"


_proxy_limiter = Limiter(key_func=_proxy_rate_limit_key, headers_enabled=True)


# ── Circuit breaker ───────────────────────────────────────────────────────────

_LLM_TIMEOUT     = float(os.getenv("GATEWAY_LLM_TIMEOUT_SECS", "30"))
_ENFORCE_TIMEOUT = float(os.getenv("GATEWAY_ENFORCE_TIMEOUT_SECS", "5"))
_CB_THRESHOLD    = 5
_CB_WINDOW       = 60
_circuit = {"failures": 0, "tripped_at": None, "first_failure_at": None}


def _circuit_state() -> str:
    if _circuit["tripped_at"] is None:
        return "closed"
    if time.time() - _circuit["tripped_at"] > _CB_WINDOW:
        _circuit["tripped_at"] = None
        _circuit["failures"] = 0
        _circuit["first_failure_at"] = None
        return "closed"
    return "open"


def _circuit_record_failure():
    now = time.time()
    if _circuit["first_failure_at"] is None or now - _circuit["first_failure_at"] > _CB_WINDOW:
        _circuit["first_failure_at"] = now
        _circuit["failures"] = 0
    _circuit["failures"] += 1
    if _circuit["failures"] >= _CB_THRESHOLD:
        _circuit["tripped_at"] = now


def _circuit_record_success():
    if _circuit["tripped_at"] is None:
        _circuit["failures"] = 0
        _circuit["first_failure_at"] = None


# ── Guard mode and enforcement ────────────────────────────────────────────────

def _resolve_guard_mode(db: Session, team: str, organization_id: int | None = None) -> str:
    """Effective mode for a team: explicit override if present, else platform default."""
    from app.models import GuardMode
    try:
        q = db.query(GuardMode).filter(GuardMode.team == team)
        if organization_id is not None:
            q = q.filter(GuardMode.organization_id == organization_id)
        row = q.first()
        if row and row.mode in _VALID_MODES:
            return row.mode
    except Exception:
        pass
    return _PLATFORM_MODE


def _shadow_or_block_inline(db, *, team, agent, model, prompt, reason, status,
                            scan_result, findings_list, organization_id=None,
                            redact_pii_text: bool = False):
    """Mode-aware block for /ask and /chat inline enforcement."""
    mode = _resolve_guard_mode(db, team, organization_id=organization_id)
    if mode == "enforce":
        tel.save_blocked(db, team=team, agent=agent, model=model, prompt=prompt,
                         reason=reason, sensitive=scan_result.is_sensitive,
                         sensitive_findings=findings_list, organization_id=organization_id,
                         redact_pii_text=redact_pii_text)
        raise HTTPException(status_code=status, detail=reason)
    findings_list.append({"type": "would_block", "severity": "warning",
                          "sample": f"WOULD BLOCK in enforce mode ({status}): {reason}"})


async def _run_enforcement_pipeline(
    db: Session, team: str, agent: str, model: str, messages: list,
    organization_id: int | None = None, redact_pii_text: bool = False,
):
    """PII scan → policy → budget; returns (last_user, scan_result, findings_list, policy_check, budget_check, large_prompt)."""
    mode = _resolve_guard_mode(db, team)
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    total_chars = sum(len(m.get("content", "") or "") for m in messages)

    scan_result   = scan(last_user)
    findings_list = scan_result.to_dict()

    LARGE_PROMPT_CHARS = 40_000
    large_prompt = total_chars > LARGE_PROMPT_CHARS
    if large_prompt:
        findings_list.append({
            "type": "large_prompt", "severity": "warning",
            "sample": f"{total_chars:,} chars across {len(messages)} messages",
        })

    def _shadow_or_block(reason: str, status: int):
        if mode == "enforce":
            tel.save_blocked(db, team=team, agent=agent, model=model,
                             prompt=last_user, reason=reason,
                             sensitive=scan_result.is_sensitive, sensitive_findings=findings_list,
                             organization_id=organization_id, redact_pii_text=redact_pii_text)
            raise HTTPException(status_code=status, detail=reason)
        findings_list.append({
            "type": "would_block", "severity": "warning",
            "sample": f"WOULD BLOCK in enforce mode ({status}): {reason}",
        })

    policy_check = pol.check_model(db, organization_id=organization_id, team=team, model=model)
    if not policy_check["allowed"]:
        _shadow_or_block(policy_check["reason"], 403)

    budget_check = bud.check(db, organization_id=organization_id, team=team, agent=agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (
            f"Budget limit exceeded for team '{blk['team']}': "
            f"${blk['spend']:.4f} of ${blk['limit']:.2f} {blk['period']} limit."
        )
        _shadow_or_block(reason, 429)

    return last_user, scan_result, findings_list, policy_check, budget_check, large_prompt


def _handle_enforcement_error(db: Session, team: str, findings_list: list,
                              organization_id: int | None = None):
    """Called when the enforcement pipeline itself throws; handles circuit breaker + fail-open logic."""
    import logging
    _circuit_record_failure()
    breaker_open = _circuit_state() == "open"
    mode = _resolve_guard_mode(db, team, organization_id=organization_id)
    if mode == "enforce" and not breaker_open:
        logging.getLogger("ai_asset_mgmt").error("Enforcement error (enforce mode)", exc_info=True)
        raise HTTPException(status_code=503, detail="Gateway enforcement error. Please try again.")
    why = "circuit breaker OPEN" if breaker_open else f"{mode} mode"
    logging.getLogger("ai_asset_mgmt").error(
        "FAIL-OPEN BYPASS (%s): enforcement error swallowed", why, exc_info=True)
    findings_list.append({"type": "enforcement_bypass", "severity": "critical",
                          "sample": f"fail-open ({why}) swallowed an enforcement error"})


# ── /ask ──────────────────────────────────────────────────────────────────────

@router.post("/ask", response_model=AskResponse, tags=["POST — Ask / Create"])
async def ask(req: AskRequest, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    org_id = current_user.organization_id
    _pii_redact = (_get_org_config(db, org_id, "pii_redaction_mode") or "full") == "findings_only"

    scan_result = scan(req.prompt)
    findings_list = scan_result.to_dict()
    if len(req.prompt) > 40_000:
        findings_list.append({"type": "large_prompt", "severity": "warning",
                               "sample": f"{len(req.prompt):,} chars"})

    policy_check = pol.check_model(db, organization_id=org_id, team=req.team, model=req.model)
    if not policy_check["allowed"]:
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=req.prompt, reason=policy_check["reason"], status=403,
                                scan_result=scan_result, findings_list=findings_list,
                                organization_id=org_id, redact_pii_text=_pii_redact)

    budget_check = bud.check(db, organization_id=org_id, team=req.team, agent=req.agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (
            f"Budget limit exceeded for team '{blk['team']}'"
            + (f", agent '{blk['agent']}'" if blk["agent"] else "")
            + f": ${blk['spend']:.4f} spent of ${blk['limit']:.2f} {blk['period']} limit."
        )
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=req.prompt, reason=reason, status=429,
                                scan_result=scan_result, findings_list=findings_list,
                                organization_id=org_id, redact_pii_text=_pii_redact)

    try:
        result = await complete(prompt=req.prompt, model=req.model, system_prompt=req.system_prompt)
    except RuntimeError:
        import logging; logging.getLogger("ai_asset_mgmt").error("Service error", exc_info=True)
        raise HTTPException(status_code=503, detail="Service temporarily unavailable. Please try again.")
    except Exception:
        import logging; logging.getLogger("ai_asset_mgmt").error("LLM error", exc_info=True)
        raise HTTPException(status_code=502, detail="Upstream LLM error. Please try again.")

    record = tel.save(
        db=db, team=req.team, agent=req.agent, prompt=req.prompt, result=result,
        sensitive=scan_result.is_sensitive, sensitive_findings=findings_list,
        organization_id=org_id, redact_pii_text=_pii_redact,
    )

    org_id = current_user.organization_id
    target_uuid = req.session_uuid
    if target_uuid:
        s = sess.get_session(db, target_uuid, organization_id=org_id)
        if not (s and s.is_active):
            target_uuid = None

    if not target_uuid:
        new_session = sess.create_session(
            db, user_name=req.agent, user_role="analyst",
            team=req.team, agent=req.agent, model=req.model,
            organization_id=org_id,
        )
        target_uuid = new_session.session_uuid

    sess.add_message(db, session_uuid=target_uuid, role="user", content=req.prompt,
                     organization_id=org_id)
    sess.add_message(db, session_uuid=target_uuid, role="assistant", content=result.content,
                     prompt_tokens=result.prompt_tokens,
                     completion_tokens=result.completion_tokens,
                     cost_usd=record.cost_usd, latency_ms=result.latency_ms,
                     security_findings=findings_list,
                     budget_warnings=budget_check["warnings"],
                     organization_id=org_id)

    return AskResponse(
        response=result.content,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
        cost_usd=record.cost_usd,
        telemetry_id=record.id,
        session_uuid=target_uuid,
        budget_warnings=budget_check["warnings"],
        security_findings=findings_list,
    )


# ── /chat ─────────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse, tags=["POST — Ask / Create"])
async def chat(req: ChatRequest, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    org_id = current_user.organization_id
    _pii_redact = (_get_org_config(db, org_id, "pii_redaction_mode") or "full") == "findings_only"

    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
    scan_result  = scan(last_user)
    findings_list = scan_result.to_dict()
    total_chars = sum(len(m.content or "") for m in req.messages)
    if total_chars > 40_000:
        findings_list.append({"type": "large_prompt", "severity": "warning",
                               "sample": f"{total_chars:,} chars across {len(req.messages)} messages"})

    policy_check = pol.check_model(db, organization_id=org_id, team=req.team, model=req.model)
    if not policy_check["allowed"]:
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=last_user, reason=policy_check["reason"], status=403,
                                scan_result=scan_result, findings_list=findings_list,
                                organization_id=org_id, redact_pii_text=_pii_redact)

    budget_check = bud.check(db, organization_id=org_id, team=req.team, agent=req.agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (f"Budget limit exceeded for team '{blk['team']}': "
                  f"${blk['spend']:.4f} of ${blk['limit']:.2f} {blk['period']} limit.")
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=last_user, reason=reason, status=429,
                                scan_result=scan_result, findings_list=findings_list,
                                organization_id=org_id, redact_pii_text=_pii_redact)

    messages = []
    if req.system_prompt:
        messages.append({"role": "system", "content": req.system_prompt})
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    try:
        result = await chat_complete(messages=messages, model=req.model)
    except RuntimeError:
        import logging; logging.getLogger("ai_asset_mgmt").error("Service error", exc_info=True)
        raise HTTPException(status_code=503, detail="Service temporarily unavailable. Please try again.")
    except Exception:
        import logging; logging.getLogger("ai_asset_mgmt").error("LLM error", exc_info=True)
        raise HTTPException(status_code=502, detail="Upstream LLM error. Please try again.")

    record = tel.save(db=db, team=req.team, agent=req.agent, prompt=last_user,
                      result=result, sensitive=scan_result.is_sensitive,
                      sensitive_findings=findings_list,
                      organization_id=org_id, redact_pii_text=_pii_redact)

    return ChatResponse(
        reply=result.content,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
        cost_usd=record.cost_usd,
        telemetry_id=record.id,
        security_findings=findings_list,
        budget_warnings=budget_check["warnings"],
    )


# ── /sessions/{uuid}/chat ─────────────────────────────────────────────────────

@router.post("/sessions/{session_uuid}/chat", response_model=ChatResponse, tags=["POST — Ask / Create"])
async def session_chat(session_uuid: str, req: SessionChatRequest, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from app.routes.inventory import _assert_session_owner
    org_id = current_user.organization_id
    _pii_redact = (_get_org_config(db, org_id, "pii_redaction_mode") or "full") == "findings_only"

    s = sess.get_session(db, session_uuid, organization_id=org_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    _assert_session_owner(s, current_user)
    if not s.is_active:
        raise HTTPException(status_code=410, detail="Session has been closed or timed out")
    if req.system_prompt and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins may set a system prompt")

    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
    scan_result = scan(last_user)
    findings_list = scan_result.to_dict()
    total_chars = sum(len(m.content or "") for m in req.messages)
    if total_chars > 40_000:
        findings_list.append({"type": "large_prompt", "severity": "warning",
                               "sample": f"{total_chars:,} chars across {len(req.messages)} messages"})

    policy_check = pol.check_model(db, organization_id=org_id, team=req.team, model=req.model)
    if not policy_check["allowed"]:
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=last_user, reason=policy_check["reason"], status=403,
                                scan_result=scan_result, findings_list=findings_list,
                                organization_id=org_id, redact_pii_text=_pii_redact)

    budget_check = bud.check(db, organization_id=org_id, team=req.team, agent=req.agent)
    if not budget_check["allowed"]:
        blk = budget_check["blocked_by"]
        reason = (f"Budget limit exceeded for team '{blk['team']}': "
                  f"${blk['spend']:.4f} of ${blk['limit']:.2f} {blk['period']} limit.")
        _shadow_or_block_inline(db, team=req.team, agent=req.agent, model=req.model,
                                prompt=last_user, reason=reason, status=429,
                                scan_result=scan_result, findings_list=findings_list,
                                organization_id=org_id, redact_pii_text=_pii_redact)

    messages = []
    if req.system_prompt:
        messages.append({"role": "system", "content": req.system_prompt})
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    try:
        result = await chat_complete(messages=messages, model=req.model)
    except RuntimeError:
        import logging; logging.getLogger("ai_asset_mgmt").error("Service error", exc_info=True)
        raise HTTPException(status_code=503, detail="Service temporarily unavailable. Please try again.")
    except Exception:
        import logging; logging.getLogger("ai_asset_mgmt").error("LLM error", exc_info=True)
        raise HTTPException(status_code=502, detail="Upstream LLM error. Please try again.")

    record = tel.save(db=db, team=req.team, agent=req.agent, prompt=last_user,
                      result=result, sensitive=scan_result.is_sensitive,
                      sensitive_findings=findings_list,
                      organization_id=org_id, redact_pii_text=_pii_redact)

    sess.add_message(db, session_uuid=session_uuid, role="user", content=last_user,
                     organization_id=current_user.organization_id)
    sess.add_message(
        db, session_uuid=session_uuid, role="assistant", content=result.content,
        prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens,
        cost_usd=record.cost_usd, latency_ms=result.latency_ms,
        security_findings=findings_list, budget_warnings=budget_check["warnings"],
        organization_id=current_user.organization_id,
    )

    return ChatResponse(
        reply=result.content,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
        cost_usd=record.cost_usd,
        telemetry_id=record.id,
        security_findings=findings_list,
        budget_warnings=budget_check["warnings"],
    )


# ── /v1/chat/completions (OpenAI-compatible proxy) ───────────────────────────

async def _openai_compat_chat_impl(
    request: FastAPIRequest,
    db: Session,
    current_user,
) -> object:
    """Implementation — called by the public route which adds trace-id logging."""
    from app.identity_resolver import resolve_identity as _resolve_identity
    from app.routes.auth import register_team as _register_team

    body     = await request.json()
    model    = body.get("model", "gpt-4o-mini")
    messages = body.get("messages", [])
    stream   = body.pop("stream", False)

    org_id = _caller_org_id(current_user)
    if org_id is None:
        raise HTTPException(status_code=401, detail="No organization resolved for this credential")

    _caller_trust = "low" if isinstance(current_user, dict) else "high"
    _identity = _resolve_identity(
        org_id,
        headers={k.lower(): v for k, v in request.headers.items()},
        caller_name=_caller_name(current_user),
        caller_team=_caller_team(current_user),
        api_key_id=(current_user.get("id") if isinstance(current_user, dict)
                    else str(getattr(current_user, "id", ""))),
        user_agent=request.headers.get("user-agent", ""),
        source_ip=(request.client.host if request.client else ""),
        host=request.headers.get("host", ""),
        caller_trust=_caller_trust,
    )

    agent_id_raw    = _identity.agent_name
    agent_version   = (request.headers.get("X-Agent-Version")
                       or request.headers.get("X-Guard-Agent-Version"))
    team            = _identity.team or _caller_team(current_user) or "unknown"
    agent           = agent_id_raw
    team_raw        = _identity.team
    environment_raw = _identity.environment

    _pii_redact = (_get_org_config(db, org_id, "pii_redaction_mode") or "full") == "findings_only"
    org_client  = get_client_for_org(org_id, model, db)
    _register_team(db, org_id, team)

    _discover_asset(db, org_id, _identity.agent_key, agent_id_raw,
        team=_identity.team,
        environment=_identity.environment,
        owner=_identity.owner,
        source_hint=_identity.source,
        confidence_score=_identity.confidence_score,
        evidence_data={
            "resolution_method":  _identity.resolution_method,
            "needs_admin_review": _identity.needs_admin_review,
            "evidence":           _identity.evidence,
            **({"agent_version": agent_version} if agent_version else {}),
        },
        request_headers=dict(request.headers),
    )
    asset_key = _identity.agent_key

    # ── Relationship capture (non-fatal) ──────────────────────────────────────
    try:
        _rel = resolve_relationship({k.lower(): v for k, v in request.headers.items()})
        if _rel:
            upsert_relationship(db, org_id, _rel, source_agent_id=asset_key)
    except Exception:
        pass

    last_user      = ""
    findings_list  = []
    budget_warnings = []
    scan_result    = None
    try:
        last_user, scan_result, findings_list, _, budget_check, _ = \
            await _run_enforcement_pipeline(db, team, agent, model, messages,
                                            organization_id=org_id, redact_pii_text=_pii_redact)
        budget_warnings = budget_check["warnings"]
        _circuit_record_success()
    except HTTPException:
        raise
    except Exception:
        _handle_enforcement_error(db, team, findings_list, organization_id=org_id)

    # ── Streaming ─────────────────────────────────────────────────────────────
    if stream:
        async def relay():
            usage_data = None
            t0 = _time_mod.perf_counter()
            async for item in proxy_chat_stream(body, request=request, org_client=org_client):
                if isinstance(item, dict) and "_guard_usage" in item:
                    usage_data = item["_guard_usage"]
                    usage_data["latency_ms"] = round((_time_mod.perf_counter() - t0) * 1000, 2)
                else:
                    yield item

            if usage_data:
                tel.save(
                    db=db, team=team, agent=agent, prompt=last_user,
                    result=CR(
                        content="",
                        model=usage_data.get("model", model),
                        prompt_tokens=usage_data["prompt_tokens"],
                        completion_tokens=usage_data["completion_tokens"],
                        total_tokens=usage_data["total_tokens"],
                        latency_ms=usage_data["latency_ms"],
                    ),
                    sensitive=(scan_result.is_sensitive if scan_result else False),
                    sensitive_findings=findings_list,
                    organization_id=org_id,
                    asset_key=asset_key,
                    agent_id_raw=agent_id_raw,
                    agent_version=agent_version,
                    team_raw=team_raw,
                    environment_raw=environment_raw,
                    redact_pii_text=_pii_redact,
                )
                if org_id and _get_org_config(db, org_id, "demo_mode"):
                    _set_org_config(db, org_id, "demo_mode", False)

        return StreamingResponse(
            relay(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ── Non-streaming ─────────────────────────────────────────────────────────
    try:
        resp_dict = await proxy_chat_complete(body, org_client=org_client)
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        _log.error("upstream LLM error: %s", exc, exc_info=True)
        tel.save_blocked(db, team=team, agent=agent, model=model,
                         prompt=last_user, reason=f"upstream_error: {type(exc).__name__}: {exc}",
                         sensitive=(scan_result.is_sensitive if scan_result else False),
                         sensitive_findings=findings_list, organization_id=org_id,
                         asset_key=asset_key, agent_id_raw=agent_id_raw,
                         agent_version=agent_version, team_raw=team_raw,
                         environment_raw=environment_raw, redact_pii_text=_pii_redact)
        status, detail = _classify_upstream_exc(exc, model)
        raise HTTPException(status_code=status, detail=detail)

    latency_ms = resp_dict.pop("_latency_ms", 0.0)
    usage      = resp_dict.get("usage", {})
    pt         = usage.get("prompt_tokens", 0)
    ct         = usage.get("completion_tokens", 0)
    resp_model = resp_dict.get("model", model)

    content = ""
    choices = resp_dict.get("choices", [])
    if choices:
        content = (choices[0].get("message") or {}).get("content") or ""
    tel.save(
        db=db, team=team, agent=agent, prompt=last_user,
        result=CR(content=content, model=resp_model,
                  prompt_tokens=pt, completion_tokens=ct, total_tokens=pt + ct,
                  latency_ms=latency_ms),
        sensitive=(scan_result.is_sensitive if scan_result else False),
        sensitive_findings=findings_list,
        organization_id=org_id,
        asset_key=asset_key,
        agent_id_raw=agent_id_raw,
        agent_version=agent_version,
        team_raw=team_raw,
        environment_raw=environment_raw,
        redact_pii_text=_pii_redact,
    )
    if org_id and _get_org_config(db, org_id, "demo_mode"):
        _set_org_config(db, org_id, "demo_mode", False)

    _cost_usd, _pricing_estimated = calculate_cost(resp_model, pt, ct)
    resp_dict["x_guard"] = {
        "team":              team,
        "agent":             agent,
        "cost_usd":          _cost_usd,
        "pricing_estimated": _pricing_estimated,
        "latency_ms":        latency_ms,
        "policy_warnings":   budget_warnings,
        "security_findings": findings_list,
    }
    return JSONResponse(content=resp_dict)


@router.post("/v1/chat/completions", tags=["POST — Ask / Create"])
@_proxy_limiter.limit("60/minute")
async def openai_compat_chat(
    request: FastAPIRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_proxy_caller),
):
    """
    OpenAI-compatible chat completions endpoint.

    Accepts any Bearer token — either a dashboard JWT or an opaque gateway key.
    Forwards the **entire request body** to the upstream provider so tool_calls,
    temperature, response_format, seed, etc. all pass through unchanged.

    Full enforcement pipeline: PII scan → policy → budget → LLM → telemetry.

    Headers:
    - `X-Guard-Team`:  team name for cost attribution and policy lookup
    - `X-Guard-Agent`: agent name for telemetry
    """
    _trace = _uuid_mod.uuid4().hex[:12]
    try:
        return await _openai_compat_chat_impl(request, db, current_user)
    except HTTPException:
        raise
    except Exception as exc:
        _safe_email = (
            getattr(current_user, "email", None)
            or (current_user.get("email") if isinstance(current_user, dict) else None)
            or "unknown"
        )
        _log.exception(
            "internal_gateway_error route=/v1/chat/completions trace_id=%s org_id=%s user=%s exc_type=%s",
            _trace,
            getattr(current_user, "organization_id", None)
               or (current_user.get("organization_id") if isinstance(current_user, dict) else None),
            _safe_email,
            type(exc).__name__,
        )
        raise HTTPException(status_code=500, detail={
            "error": {
                "type": "internal_gateway_error",
                "message": "Unexpected gateway error. Check server logs with trace_id.",
                "trace_id": _trace,
            }
        })


# ── /v1/messages (Anthropic-compatible proxy) ─────────────────────────────────

async def _anthropic_compat_messages_impl(
    request: FastAPIRequest,
    db: Session,
    current_user,
) -> object:
    """Implementation — called by the public route which adds trace-id logging."""
    from app.identity_resolver import resolve_identity as _resolve_identity
    from app.routes.auth import register_team as _register_team

    body   = await request.json()
    model  = body.get("model", "claude-haiku-4-5")
    system = body.get("system", None)
    stream = body.get("stream", False)

    raw_messages = body.get("messages", [])
    oai_messages: list[dict] = []
    if system:
        oai_messages.append({"role": "system", "content": system if isinstance(system, str) else str(system)})
    for m in raw_messages:
        content = m.get("content", "")
        if isinstance(content, list):
            text_parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
            content = " ".join(text_parts)
        oai_messages.append({"role": m["role"], "content": content})

    org_id = _caller_org_id(current_user)
    if org_id is None:
        raise HTTPException(status_code=401, detail="No organization resolved for this credential")

    _caller_trust = "low" if isinstance(current_user, dict) else "high"
    _identity = _resolve_identity(
        org_id,
        headers={k.lower(): v for k, v in request.headers.items()},
        caller_name=_caller_name(current_user),
        caller_team=_caller_team(current_user),
        api_key_id=(current_user.get("id") if isinstance(current_user, dict)
                    else str(getattr(current_user, "id", ""))),
        user_agent=request.headers.get("user-agent", ""),
        source_ip=(request.client.host if request.client else ""),
        host=request.headers.get("host", ""),
        caller_trust=_caller_trust,
    )

    agent_id_raw    = _identity.agent_name
    agent_version   = (request.headers.get("X-Agent-Version")
                       or request.headers.get("X-Guard-Agent-Version"))
    team            = _identity.team or _caller_team(current_user) or "unknown"
    agent           = agent_id_raw
    team_raw        = _identity.team
    environment_raw = _identity.environment

    _pii_redact = (_get_org_config(db, org_id, "pii_redaction_mode") or "full") == "findings_only"
    org_client  = get_client_for_org(org_id, model, db)
    _register_team(db, org_id, team)

    _discover_asset(db, org_id, _identity.agent_key, agent_id_raw,
        team=_identity.team,
        environment=_identity.environment,
        owner=_identity.owner,
        source_hint=_identity.source,
        confidence_score=_identity.confidence_score,
        evidence_data={
            "resolution_method":  _identity.resolution_method,
            "needs_admin_review": _identity.needs_admin_review,
            "evidence":           _identity.evidence,
            **({"agent_version": agent_version} if agent_version else {}),
        },
        request_headers=dict(request.headers),
    )
    asset_key = _identity.agent_key

    # ── Relationship capture (non-fatal) ──────────────────────────────────────
    try:
        _rel = resolve_relationship({k.lower(): v for k, v in request.headers.items()})
        if _rel:
            upsert_relationship(db, org_id, _rel, source_agent_id=asset_key)
    except Exception:
        pass

    last_user       = ""
    findings_list   = []
    budget_warnings = []
    scan_result     = None
    try:
        last_user, scan_result, findings_list, _, budget_check, _ = \
            await _run_enforcement_pipeline(db, team, agent, model, oai_messages,
                                            organization_id=org_id, redact_pii_text=_pii_redact)
        budget_warnings = budget_check["warnings"]
        _circuit_record_success()
    except HTTPException:
        raise
    except Exception:
        _handle_enforcement_error(db, team, findings_list, organization_id=org_id)

    msg_id  = f"msg_guard_{_uuid_mod.uuid4().hex[:12]}"
    created = int(_time_mod.time())  # noqa: F841 — kept for potential future use in SSE

    oai_body: dict = {
        "model":      model,
        "messages":   oai_messages,
        "max_tokens": body.get("max_tokens", 1024),
    }
    if body.get("temperature") is not None:
        oai_body["temperature"] = body["temperature"]
    if body.get("stop_sequences"):
        oai_body["stop"] = body["stop_sequences"]

    # ── Streaming ─────────────────────────────────────────────────────────────
    if stream:
        async def anthropic_relay():
            yield (f"event: message_start\ndata: {json.dumps({'type':'message_start','message':{'id':msg_id,'type':'message','role':'assistant','content':[],'model':model,'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':0,'output_tokens':0}}})}\n\n")
            yield (f"event: content_block_start\ndata: {json.dumps({'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}})}\n\n")

            usage_data = None
            t0 = _time_mod.perf_counter()
            async for item in proxy_chat_stream(oai_body, request=request, org_client=org_client):
                if isinstance(item, dict) and "_guard_usage" in item:
                    usage_data = item["_guard_usage"]
                    usage_data["latency_ms"] = round((_time_mod.perf_counter() - t0) * 1000, 2)
                    continue
                if item.startswith("data: ") and item.strip() != "data: [DONE]":
                    try:
                        chunk = json.loads(item[6:])
                        delta_content = ""
                        for ch in chunk.get("choices", []):
                            delta_content += (ch.get("delta") or {}).get("content") or ""
                        if delta_content:
                            yield (f"event: content_block_delta\ndata: {json.dumps({'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':delta_content}})}\n\n")
                    except Exception:
                        pass

            yield f"event: content_block_stop\ndata: {json.dumps({'type':'content_block_stop','index':0})}\n\n"
            out_tokens = (usage_data or {}).get("completion_tokens", 0)
            in_tokens  = (usage_data or {}).get("prompt_tokens", 0)
            yield (f"event: message_delta\ndata: {json.dumps({'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':out_tokens}})}\n\n")
            yield f"event: message_stop\ndata: {json.dumps({'type':'message_stop'})}\n\n"

            if usage_data:
                tel.save(
                    db=db, team=team, agent=agent, prompt=last_user,
                    result=CR(content="", model=usage_data.get("model", model),
                               prompt_tokens=in_tokens, completion_tokens=out_tokens,
                               total_tokens=in_tokens + out_tokens,
                               latency_ms=usage_data["latency_ms"]),
                    sensitive=(scan_result.is_sensitive if scan_result else False),
                    sensitive_findings=findings_list,
                    organization_id=org_id,
                    asset_key=asset_key,
                    agent_id_raw=agent_id_raw,
                    agent_version=agent_version,
                    team_raw=team_raw,
                    environment_raw=environment_raw,
                    redact_pii_text=_pii_redact,
                )
                if org_id and _get_org_config(db, org_id, "demo_mode"):
                    _set_org_config(db, org_id, "demo_mode", False)

        return StreamingResponse(
            anthropic_relay(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ── Non-streaming ─────────────────────────────────────────────────────────
    try:
        resp_dict = await proxy_chat_complete(oai_body, org_client=org_client)
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        _log.error("upstream LLM error: %s", exc, exc_info=True)
        tel.save_blocked(db, team=team, agent=agent, model=model,
                         prompt=last_user, reason=f"upstream_error: {type(exc).__name__}: {exc}",
                         sensitive=(scan_result.is_sensitive if scan_result else False),
                         sensitive_findings=findings_list, organization_id=org_id,
                         asset_key=asset_key, agent_id_raw=agent_id_raw,
                         agent_version=agent_version, team_raw=team_raw,
                         environment_raw=environment_raw, redact_pii_text=_pii_redact)
        status, detail = _classify_upstream_exc(exc, model)
        raise HTTPException(status_code=status, detail=detail)

    latency_ms = resp_dict.pop("_latency_ms", 0.0)
    usage      = resp_dict.get("usage", {})
    pt         = usage.get("prompt_tokens", 0)
    ct         = usage.get("completion_tokens", 0)
    resp_model = resp_dict.get("model", model)
    content    = ""
    choices    = resp_dict.get("choices", [])
    if choices:
        content = (choices[0].get("message") or {}).get("content") or ""

    tel.save(
        db=db, team=team, agent=agent, prompt=last_user,
        result=CR(content=content, model=resp_model,
                  prompt_tokens=pt, completion_tokens=ct, total_tokens=pt + ct,
                  latency_ms=latency_ms),
        sensitive=(scan_result.is_sensitive if scan_result else False),
        sensitive_findings=findings_list,
        organization_id=org_id,
        asset_key=asset_key,
        agent_id_raw=agent_id_raw,
        agent_version=agent_version,
        team_raw=team_raw,
        environment_raw=environment_raw,
        redact_pii_text=_pii_redact,
    )
    if org_id and _get_org_config(db, org_id, "demo_mode"):
        _set_org_config(db, org_id, "demo_mode", False)

    _anth_cost, _anth_pricing_estimated = calculate_cost(resp_model, pt, ct)
    return JSONResponse(content={
        "id":            msg_id,
        "type":          "message",
        "role":          "assistant",
        "content":       [{"type": "text", "text": content}],
        "model":         resp_model,
        "stop_reason":   "end_turn",
        "stop_sequence": None,
        "usage": {
            "input_tokens":  pt,
            "output_tokens": ct,
        },
        "x_guard": {
            "team":              team,
            "agent":             agent,
            "cost_usd":          _anth_cost,
            "pricing_estimated": _anth_pricing_estimated,
            "latency_ms":        latency_ms,
            "policy_warnings":   budget_warnings,
            "security_findings": findings_list,
        },
    })


@router.post("/v1/messages", tags=["POST — Ask / Create"])
@_proxy_limiter.limit("60/minute")
async def anthropic_compat_messages(
    request: FastAPIRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_proxy_caller),
):
    """
    Anthropic-compatible Messages API endpoint.

    Teams using the Anthropic SDK point here:
    ```python
    import anthropic
    client = anthropic.Anthropic(base_url="http://your-server", api_key="<token>")
    ```

    Accepts the standard Anthropic request shape and returns the standard
    Anthropic response shape, including SSE streaming.

    Full enforcement pipeline: PII scan → policy → budget → LLM → telemetry.

    Headers:
    - `X-Guard-Team`:  team name for cost attribution
    - `X-Guard-Agent`: agent name for telemetry
    """
    _trace = _uuid_mod.uuid4().hex[:12]
    try:
        return await _anthropic_compat_messages_impl(request, db, current_user)
    except HTTPException:
        raise
    except Exception as exc:
        _safe_email = (
            getattr(current_user, "email", None)
            or (current_user.get("email") if isinstance(current_user, dict) else None)
            or "unknown"
        )
        _log.exception(
            "internal_gateway_error route=/v1/messages trace_id=%s org_id=%s user=%s exc_type=%s",
            _trace,
            getattr(current_user, "organization_id", None)
               or (current_user.get("organization_id") if isinstance(current_user, dict) else None),
            _safe_email,
            type(exc).__name__,
        )
        raise HTTPException(status_code=500, detail={
            "error": {
                "type": "internal_gateway_error",
                "message": "Unexpected gateway error. Check server logs with trace_id.",
                "trace_id": _trace,
            }
        })
