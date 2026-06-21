#!/usr/bin/env python3
"""
Seed demo data for the AI Agent Inventory dashboard.

Creates a realistic dataset that demonstrates the full identity-resolution
pipeline:
  • 25 gateway agents discovered via explicit X-Agent-* headers (95% confidence)
  •  7 gateway agents auto-detected without headers:
       - 3 via AI framework fingerprint  (65%)
       - 2 via API key scope             (75%)
       - 1 via request-origin hostname   (45%)
       - 1 via fallback hash             (15%, needs admin review)
  • 13 platform-discovered potential agents (no gateway traffic yet)

Usage:
    python scripts/seed_demo_data.py
    python scripts/seed_demo_data.py --clear
"""
import argparse
import hashlib
import json
import os
import random
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import engine, SessionLocal
from app.models import Base, Telemetry, AssetRegistry, Organization

random.seed(42)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _asset_key(org_id: int, agent_id_raw: str) -> str:
    return hashlib.sha256(f"{org_id}:{agent_id_raw}".encode()).hexdigest()

def cost_usd(model, prompt_tokens, completion_tokens):
    rates = {
        "gpt-4.1":                    (0.002,   0.008),
        "gpt-4.1-mini":               (0.0004,  0.0016),
        "gpt-4o":                     (0.0025,  0.010),
        "claude-sonnet-4-5":          (0.003,   0.015),
        "claude-haiku-4-5":           (0.0008,  0.004),
        "claude-haiku-4-5-20251001":  (0.0008,  0.004),
        "claude-opus-4-5":            (0.015,   0.075),
        "gpt-4o-mini":                (0.00015, 0.0006),
    }
    in_r, out_r = rates.get(model, (0.002, 0.008))
    return (prompt_tokens / 1000) * in_r + (completion_tokens / 1000) * out_r

def _ensure_columns():
    from sqlalchemy import inspect as _inspect, text as _text
    with engine.connect() as conn:
        insp = _inspect(engine)

        # Telemetry table
        t_cols = {c["name"] for c in insp.get_columns("telemetry")}
        for col_name, col_def in [
            ("asset_key",       "VARCHAR(64)"),
            ("agent_id_raw",    "VARCHAR(256)"),
            ("agent_version",   "VARCHAR(128)"),
            ("team_raw",        "VARCHAR(128)"),
            ("environment_raw", "VARCHAR(64)"),
        ]:
            if col_name not in t_cols:
                conn.execute(_text(f"ALTER TABLE telemetry ADD COLUMN {col_name} {col_def}"))

        # Asset registry table — add columns introduced after initial migration
        r_cols = {c["name"] for c in insp.get_columns("asset_registry")}
        for col_name, col_def in [
            ("discovery_status",  "VARCHAR(32) DEFAULT 'verified'"),
            ("discovery_source",  "VARCHAR(64)"),
            ("discovery_reason",  "TEXT"),
            ("evidence",          "TEXT"),
            ("confidence_score",  "FLOAT DEFAULT 95.0"),
            ("claimed_by",        "VARCHAR(256)"),
            ("claimed_at",        "DATETIME"),
            ("first_seen_at",     "DATETIME"),
        ]:
            if col_name not in r_cols:
                conn.execute(_text(f"ALTER TABLE asset_registry ADD COLUMN {col_name} {col_def}"))

        conn.commit()


# ─────────────────────────────────────────────────────────────────────────────
# GATEWAY AGENTS — explicit X-Agent-* headers (resolution_method: explicit_headers)
# confidence 95%, needs_admin_review: False
# ─────────────────────────────────────────────────────────────────────────────

GATEWAY_AGENTS = [
    # (agent_id_raw, team, profile, version, env)
    ("support-triage-v2",    "customer-support",   "high",        "2.3.1", "prod"),
    ("doc-summarizer",       "platform-ai",        "medium",      "1.5.0", "prod"),
    ("code-reviewer",        "platform-ai",        "medium",      "3.0.2", "prod"),
    ("risk-classifier",      "risk-analytics",     "high",        "1.4.0", "prod"),
    ("trade-narrator",       "trading-research",   "very_high",   "3.1.2", "prod"),
    ("route-planner",        "route-optimization", "medium",      "1.2.0", "prod"),
    ("invoice-extractor",    "risk-analytics",     "pii_heavy",   "2.1.0", "prod"),
    ("kb-rag-search",        "customer-support",   "medium",      "1.0.3", "prod"),
    ("research-deepdive",    "trading-research",   "large_tokens","1.1.0", "staging"),
    ("qa-test-generator",    "platform-ai",        "failing",     "0.9.1", "staging"),
    ("contract-analyzer",    "risk-analytics",     "pii_heavy",   "2.0.0", "prod"),
    ("email-classifier",     "customer-support",   "low",         "1.3.0", "prod"),
    ("market-sentiment",     "trading-research",   "high",        "2.2.0", "prod"),
    ("pipeline-monitor",     "data-engineering",   "after_hours", "1.0.0", "prod"),
    ("feature-extractor",    "data-engineering",   "loop",        "0.8.0", "staging"),
    ("user-intent-detector", "product-ml",         "medium",      "2.0.1", "prod"),
    ("churn-predictor",      "product-ml",         "low",         "1.1.0", "staging"),
    ("compliance-scanner",   "risk-analytics",     "blocked",     "1.2.5", "prod"),
    ("alert-correlator",     "platform-ai",        "dormant",     "1.0.0", "staging"),
    ("batch-embedder",       "data-engineering",   "dormant",     "2.3.0", "staging"),
    ("legacy-classifier",    "risk-analytics",     "inactive",    "0.5.0", "dev"),
    ("old-chatbot-v1",       "customer-support",   "inactive",    "1.0.0", "dev"),
    ("prototype-agent-x",    "product-ml",         "inactive",    "0.1.0", "dev"),
    ("hedge-optimizer",      "trading-research",   "premium",     "4.0.0", "prod"),
    ("supply-chain-ai",      "route-optimization", "medium",      "1.8.0", "prod"),
]

# ─────────────────────────────────────────────────────────────────────────────
# AUTO-DETECTED GATEWAY AGENTS — no explicit headers, resolved automatically
# ─────────────────────────────────────────────────────────────────────────────

AUTO_DETECTED_AGENTS = [
    # (agent_id_raw, team, profile, version, env, resolution_method, confidence, lifecycle)

    # Framework fingerprint in User-Agent → confidence 65%, needs admin review
    ("langchain-agent",         "data-engineering",   "medium", None,    "prod",    "framework_metadata", 65.0, "needs_validation"),
    ("crewai-pipeline",         "platform-ai",        "low",    None,    "staging", "framework_metadata", 65.0, "needs_validation"),
    ("autogen-orchestrator",    "product-ml",         "medium", None,    "prod",    "framework_metadata", 65.0, "needs_validation"),

    # API key scope (key was given a meaningful name) → confidence 75%
    ("data-pipeline-service",   "data-engineering",   "high",   "2.1.0", "prod",    "api_key_scope",      75.0, "unassigned"),
    ("analytics-worker",        "trading-research",   "medium", "1.0.0", "prod",    "api_key_scope",      75.0, "managed"),

    # Request-origin hostname → confidence 45%, needs admin review
    ("acme-reporting",          "platform-ai",        "low",    None,    "prod",    "request_origin",     45.0, "needs_validation"),

    # Fallback hash — no usable signal → confidence 15%, needs admin review
    ("unknown-agent-3a9fb12c",  "unknown",            "low",    None,    None,      "fallback_hash",      15.0, "needs_validation"),
]

# ─────────────────────────────────────────────────────────────────────────────
# Registry metadata for all gateway agents
# ─────────────────────────────────────────────────────────────────────────────

GATEWAY_REGISTRY = {
    # ── Explicit-header agents (resolution_method: explicit_headers, 95%) ────
    "support-triage-v2": {
        "lifecycle": "managed", "owner": "alice@acme.ai", "team": "customer-support",
        "env": "prod", "criticality": "high", "claimed_days_ago": 45,
        "business_purpose": "Routes incoming customer tickets to the correct support tier using intent classification.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "doc-summarizer": {
        "lifecycle": "managed", "owner": "bob@acme.ai", "team": "platform-ai",
        "env": "prod", "criticality": "medium", "claimed_days_ago": 30,
        "business_purpose": "Generates concise summaries of internal documentation and meeting notes.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "code-reviewer": {
        "lifecycle": "managed", "owner": "bob@acme.ai", "team": "platform-ai",
        "env": "prod", "criticality": "medium", "claimed_days_ago": 20,
        "business_purpose": "Performs automated code review for pull requests in the CI pipeline.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "risk-classifier": {
        "lifecycle": "managed", "owner": "carol@acme.ai", "team": "risk-analytics",
        "env": "prod", "criticality": "critical", "claimed_days_ago": 60,
        "business_purpose": "Classifies transaction risk in real-time for the fraud detection pipeline.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "trade-narrator": {
        "lifecycle": "managed", "owner": "dave@acme.ai", "team": "trading-research",
        "env": "prod", "criticality": "high", "claimed_days_ago": 35,
        "business_purpose": "Generates natural-language explanations of algorithmic trading decisions for compliance audit trails.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "route-planner": {
        "lifecycle": "managed", "owner": "eve@acme.ai", "team": "route-optimization",
        "env": "prod", "criticality": "high", "claimed_days_ago": 25,
        "business_purpose": "Optimises last-mile delivery routes using real-time traffic and capacity data.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "invoice-extractor": {
        "lifecycle": "managed", "owner": "carol@acme.ai", "team": "risk-analytics",
        "env": "prod", "criticality": "critical", "claimed_days_ago": 50,
        "business_purpose": "Extracts structured data from vendor invoices. Handles PII under active DPA.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "kb-rag-search": {
        "lifecycle": "managed", "owner": "alice@acme.ai", "team": "customer-support",
        "env": "prod", "criticality": "medium", "claimed_days_ago": 22,
        "business_purpose": "Retrieval-augmented search over the knowledge base for support agents.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "research-deepdive": {
        "lifecycle": "managed", "owner": "dave@acme.ai", "team": "trading-research",
        "env": "staging", "criticality": "high", "claimed_days_ago": 15,
        "business_purpose": "Deep-research synthesis for market opportunity analysis; uses long-context frontier model.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "qa-test-generator":    {"lifecycle": "unassigned", "source": "gateway_telemetry", "confidence": 95.0, "resolution_method": "explicit_headers"},
    "contract-analyzer": {
        "lifecycle": "managed", "owner": "carol@acme.ai", "team": "risk-analytics",
        "env": "prod", "criticality": "critical", "claimed_days_ago": 40,
        "business_purpose": "Scans legal contracts for compliance violations and risk clauses.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "email-classifier": {
        "lifecycle": "managed", "owner": "alice@acme.ai", "team": "customer-support",
        "env": "prod", "criticality": "low", "claimed_days_ago": 18,
        "business_purpose": "Classifies inbound customer emails by intent for automated queue routing.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "market-sentiment": {
        "lifecycle": "managed", "owner": "dave@acme.ai", "team": "trading-research",
        "env": "prod", "criticality": "high", "claimed_days_ago": 28,
        "business_purpose": "Aggregates and scores market sentiment from financial news and social signals.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "pipeline-monitor":     {"lifecycle": "unassigned", "source": "gateway_telemetry", "confidence": 95.0, "resolution_method": "explicit_headers"},
    "feature-extractor":    {"lifecycle": "unassigned", "source": "gateway_telemetry", "confidence": 95.0, "resolution_method": "explicit_headers"},
    "user-intent-detector": {
        "lifecycle": "managed", "owner": "frank@acme.ai", "team": "product-ml",
        "env": "prod", "criticality": "medium", "claimed_days_ago": 12,
        "business_purpose": "Detects user intent signals from product interactions for personalisation.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "churn-predictor":      {"lifecycle": "unassigned", "source": "gateway_telemetry", "confidence": 95.0, "resolution_method": "explicit_headers"},
    "compliance-scanner": {
        "lifecycle": "managed", "owner": "carol@acme.ai", "team": "risk-analytics",
        "env": "prod", "criticality": "critical", "claimed_days_ago": 55,
        "business_purpose": "Scans outbound communications for regulatory compliance violations (FINRA, SEC).",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "alert-correlator":     {"lifecycle": "unassigned", "source": "gateway_telemetry", "confidence": 95.0, "resolution_method": "explicit_headers"},
    "batch-embedder":       {"lifecycle": "unassigned", "source": "gateway_telemetry", "confidence": 95.0, "resolution_method": "explicit_headers"},
    "legacy-classifier": {
        "lifecycle": "retired", "owner": "carol@acme.ai", "team": "risk-analytics",
        "env": "dev", "criticality": "low", "claimed_days_ago": 90,
        "business_purpose": "Legacy risk classifier replaced by risk-classifier v1.4.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "old-chatbot-v1": {
        "lifecycle": "retired", "owner": "alice@acme.ai", "team": "customer-support",
        "env": "dev", "criticality": "low", "claimed_days_ago": 80,
        "business_purpose": "First-generation support chatbot superseded by support-triage-v2.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "prototype-agent-x": {
        "lifecycle": "retired", "owner": "frank@acme.ai", "team": "product-ml",
        "env": "dev", "criticality": "low", "claimed_days_ago": 70,
        "business_purpose": "Experimental prototype from Q1 hackathon; never promoted to production.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "hedge-optimizer": {
        "lifecycle": "managed", "owner": "dave@acme.ai", "team": "trading-research",
        "env": "prod", "criticality": "critical", "claimed_days_ago": 42,
        "business_purpose": "Generates hedge ratios and rebalancing recommendations for the quant desk.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },
    "supply-chain-ai": {
        "lifecycle": "managed", "owner": "eve@acme.ai", "team": "route-optimization",
        "env": "prod", "criticality": "high", "claimed_days_ago": 33,
        "business_purpose": "Predicts supply chain disruptions and recommends mitigation actions.",
        "source": "gateway_telemetry", "confidence": 95.0,
        "resolution_method": "explicit_headers",
    },

    # ── Auto-detected: framework fingerprint (65%, needs_admin_review: True) ──
    "langchain-agent": {
        "lifecycle": "needs_validation", "team": "data-engineering",
        "source": "gateway_telemetry", "confidence": 65.0,
        "resolution_method": "framework_metadata",
        "evidence": {
            "resolution_method": "framework_metadata",
            "needs_admin_review": True,
            "evidence": [
                "AI framework detected in User-Agent: 'langchain-agent'",
                "User-Agent: 'langchain/0.2.16 (Python 3.11; aiohttp/3.9)'",
            ],
        },
    },
    "crewai-pipeline": {
        "lifecycle": "needs_validation", "team": "platform-ai",
        "source": "gateway_telemetry", "confidence": 65.0,
        "resolution_method": "framework_metadata",
        "evidence": {
            "resolution_method": "framework_metadata",
            "needs_admin_review": True,
            "evidence": [
                "AI framework detected in User-Agent: 'crewai-agent'",
                "User-Agent: 'crewai/0.80.0 python-httpx/0.27'",
            ],
        },
    },
    "autogen-orchestrator": {
        "lifecycle": "needs_validation", "team": "product-ml",
        "source": "gateway_telemetry", "confidence": 65.0,
        "resolution_method": "framework_metadata",
        "evidence": {
            "resolution_method": "framework_metadata",
            "needs_admin_review": True,
            "evidence": [
                "AI framework detected in User-Agent: 'autogen-agent'",
                "User-Agent: 'pyautogen/0.4.2 openai/1.55'",
            ],
        },
    },

    # ── Auto-detected: API key scope (75%, needs_admin_review: False) ────────
    "data-pipeline-service": {
        "lifecycle": "unassigned", "team": "data-engineering",
        "source": "gateway_telemetry", "confidence": 75.0,
        "resolution_method": "api_key_scope",
        "evidence": {
            "resolution_method": "api_key_scope",
            "needs_admin_review": False,
            "evidence": ["API key scope: caller_name='data-pipeline-service'"],
            "agent_version": "2.1.0",
        },
    },
    "analytics-worker": {
        "lifecycle": "managed", "owner": "dave@acme.ai", "team": "trading-research",
        "env": "prod", "criticality": "medium", "claimed_days_ago": 8,
        "business_purpose": "Batch analytics worker that runs nightly market summaries via API key scope.",
        "source": "gateway_telemetry", "confidence": 75.0,
        "resolution_method": "api_key_scope",
        "evidence": {
            "resolution_method": "api_key_scope",
            "needs_admin_review": False,
            "evidence": ["API key scope: caller_name='analytics-worker'"],
            "agent_version": "1.0.0",
        },
    },

    # ── Auto-detected: request-origin hostname (45%, needs_admin_review: True) ─
    "acme-reporting": {
        "lifecycle": "needs_validation", "team": "platform-ai",
        "source": "gateway_telemetry", "confidence": 45.0,
        "resolution_method": "request_origin",
        "evidence": {
            "resolution_method": "request_origin",
            "needs_admin_review": True,
            "evidence": ["Request host: 'acme-reporting.internal:8443'"],
        },
    },

    # ── Auto-detected: fallback hash (15%, needs_admin_review: True) ─────────
    "unknown-agent-3a9fb12c": {
        "lifecycle": "needs_validation", "team": "unknown",
        "source": "gateway_telemetry", "confidence": 15.0,
        "resolution_method": "fallback_hash",
        "evidence": {
            "resolution_method": "fallback_hash",
            "needs_admin_review": True,
            "evidence": [
                "No reliable identity signal — generated stable fallback hash",
                "User-Agent: 'python-requests/2.31.0'",
                "Source IP: 10.4.12.55",
            ],
        },
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# PLATFORM-DISCOVERED POTENTIAL AGENTS — no gateway traffic, awaiting validation
# ─────────────────────────────────────────────────────────────────────────────

POTENTIAL_AGENTS = [
    {
        "agent_id_raw": "gh-actions-llm-review",
        "team": "platform-ai",
        "source": "github",
        "confidence": 72.0,
        "evidence": {
            "repository": "acme/platform-tools",
            "workflow_file": ".github/workflows/llm-review.yml",
            "api_calls_detected": ["openai.ChatCompletion.create"],
            "first_seen": "2026-06-01",
            "commit": "a3f9b12",
        },
    },
    {
        "agent_id_raw": "slack-summariser-bot",
        "team": "customer-support",
        "source": "slack",
        "confidence": 58.0,
        "evidence": {
            "workspace": "acme.slack.com",
            "app_name": "ChannelSummariser",
            "scopes": ["channels:read", "chat:write"],
            "openai_api_key_env": "OPENAI_KEY",
            "first_seen": "2026-05-28",
        },
    },
    {
        "agent_id_raw": "n8n-contract-workflow",
        "team": "risk-analytics",
        "source": "n8n",
        "confidence": 65.0,
        "evidence": {
            "workflow_id": "wf_4421",
            "workflow_name": "Contract Review Automation",
            "nodes": ["OpenAI", "HTTP Request", "Postgres"],
            "trigger": "webhook",
            "first_seen": "2026-06-05",
        },
    },
    {
        "agent_id_raw": "jira-ticket-classifier",
        "team": "product-ml",
        "source": "jira",
        "confidence": 45.0,
        "evidence": {
            "project": "PROD",
            "automation_rule": "Auto-classify incoming tickets",
            "api_endpoint": "api.openai.com",
            "first_seen": "2026-05-20",
        },
    },
    {
        "agent_id_raw": "azure-fn-sentiment",
        "team": "trading-research",
        "source": "cloud_functions",
        "confidence": 61.0,
        "evidence": {
            "function_app": "acme-trading-fns",
            "function_name": "SentimentAnalyser",
            "runtime": "python3.11",
            "env_vars_detected": ["ANTHROPIC_API_KEY"],
            "region": "eastus",
            "first_seen": "2026-06-03",
        },
    },
    {
        "agent_id_raw": "servicenow-incident-ai",
        "team": "platform-ai",
        "source": "servicenow",
        "confidence": 38.0,
        "evidence": {
            "instance": "acme.service-now.com",
            "table": "incident",
            "integration": "AI Search (Preview)",
            "first_seen": "2026-05-15",
        },
    },
    {
        "agent_id_raw": "mcp-data-analyst",
        "team": "data-engineering",
        "source": "mcp",
        "confidence": 80.0,
        "evidence": {
            "server_name": "acme-data-mcp",
            "tools": ["query_warehouse", "generate_report", "explain_anomaly"],
            "model": "claude-sonnet-4-5",
            "first_seen": "2026-06-10",
        },
    },
    {
        "agent_id_raw": "gh-test-gen-bot",
        "team": "platform-ai",
        "source": "github",
        "confidence": 55.0,
        "evidence": {
            "repository": "acme/backend-api",
            "workflow_file": ".github/workflows/test-gen.yml",
            "api_calls_detected": ["anthropic.messages.create"],
            "first_seen": "2026-06-08",
            "commit": "c71e443",
        },
    },
    {
        "agent_id_raw": "lambda-doc-extractor",
        "team": "risk-analytics",
        "source": "cloud_functions",
        "confidence": 69.0,
        "evidence": {
            "function_name": "DocExtractorFn",
            "runtime": "nodejs18.x",
            "env_vars_detected": ["OPENAI_API_KEY"],
            "region": "us-east-1",
            "trigger": "s3:ObjectCreated",
            "first_seen": "2026-06-02",
        },
    },
    {
        "agent_id_raw": "n8n-lead-scorer",
        "team": "product-ml",
        "source": "n8n",
        "confidence": 50.0,
        "evidence": {
            "workflow_id": "wf_3812",
            "workflow_name": "Lead Scoring Pipeline",
            "nodes": ["OpenAI", "CRM Webhook", "Slack"],
            "trigger": "schedule",
            "first_seen": "2026-05-25",
        },
    },
    # ── New platform-discovered agents ────────────────────────────────────────
    {
        "agent_id_raw": "azure-devops-pr-reviewer",
        "team": "platform-ai",
        "source": "azure_devops",
        "confidence": 68.0,
        "evidence": {
            "organisation": "acme",
            "project": "CorePlatform",
            "pipeline": "AI-PR-Review",
            "pipeline_id": 1147,
            "task": "OpenAI Review Gate",
            "env_vars_detected": ["OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"],
            "first_seen": "2026-06-12",
        },
    },
    {
        "agent_id_raw": "gh-pr-analyst",
        "team": "platform-ai",
        "source": "github",
        "confidence": 62.0,
        "evidence": {
            "repository": "acme/data-platform",
            "workflow_file": ".github/workflows/pr-analyst.yml",
            "api_calls_detected": ["anthropic.messages.create", "openai.ChatCompletion.create"],
            "trigger": "pull_request",
            "first_seen": "2026-06-14",
            "commit": "f88da31",
        },
    },
    {
        "agent_id_raw": "lambda-budget-forecast",
        "team": "risk-analytics",
        "source": "cloud_functions",
        "confidence": 71.0,
        "evidence": {
            "function_name": "BudgetForecastFn",
            "runtime": "python3.12",
            "env_vars_detected": ["ANTHROPIC_API_KEY"],
            "region": "us-west-2",
            "trigger": "EventBridge (weekly)",
            "first_seen": "2026-06-09",
        },
    },
]


# ── Telemetry profiles ────────────────────────────────────────────────────────

MODELS = ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "claude-sonnet-4-5",
          "claude-haiku-4-5", "claude-opus-4-5", "gpt-4o-mini"]

def make_calls(agent_id_raw, team, profile, org_id, now, version=None, env=None):
    key = _asset_key(org_id, agent_id_raw)
    calls = []

    def call(h, model=None, pt=None, ct=None, sensitive=False, blocked=False, reason=None):
        ts = now - timedelta(hours=h)
        m  = model or random.choice(MODELS[:4])
        p  = pt or random.randint(200, 2000)
        c  = ct or random.randint(100, 800)
        calls.append(Telemetry(
            organization_id=org_id,
            team=team, agent=agent_id_raw, model=m,
            prompt=f"[demo] {agent_id_raw} T-{h:.0f}h",
            response="" if blocked else f"[demo] {agent_id_raw} response",
            prompt_tokens=p, completion_tokens=c, total_tokens=p + c,
            latency_ms=random.uniform(300, 2500),
            cost_usd=cost_usd(m, p, c) if not blocked else 0.0,
            pricing_estimated=False,
            sensitive=sensitive, blocked=blocked, block_reason=reason,
            timestamp=ts,
            asset_key=key, agent_id_raw=agent_id_raw,
            agent_version=version, team_raw=team, environment_raw=env,
        ))

    p = profile
    if p == "high":
        for h in range(0, 168, 4):   call(h + random.uniform(0, 3))
    elif p == "very_high":
        for h in range(0, 168, 2):   call(h, "claude-opus-4-5", 3000, 1500)
    elif p == "medium":
        for h in range(0, 120, 12):  call(h + random.uniform(0, 8))
    elif p == "low":
        for h in range(0, 72, 24):   call(h)
    elif p == "pii_heavy":
        for h in range(0, 96, 4):    call(h, sensitive=random.random() < 0.4)
    elif p == "large_tokens":
        for h in range(0, 72, 8):    call(h, "claude-opus-4-5", 45000, 3000)
    elif p == "failing":
        for h in range(0, 48, 3):
            blk = random.random() < 0.4
            call(h, blocked=blk, reason="policy_violation" if blk else None)
    elif p == "after_hours":
        for day in range(7):
            for off in range(3):     call(day * 24 + 2 + off)
    elif p == "loop":
        for i in range(20):          call(random.uniform(1, 2), "gpt-4.1-mini", 500, 200)
        for h in range(3, 96, 12):   call(h)
    elif p == "blocked":
        for h in range(0, 72, 6):
            blk = random.random() < 0.5
            call(h, blocked=blk, reason="budget_exceeded" if blk else None)
    elif p == "premium":
        for h in range(0, 48, 3):
            call(h, "claude-opus-4-5", random.randint(500, 3000), random.randint(200, 1500))
    elif p == "dormant":
        for d in range(10, 25, 5):   call(d * 24)
    elif p == "inactive":
        for d in range(35, 60, 10):  call(d * 24)

    return calls


# ── Seeding ───────────────────────────────────────────────────────────────────

def seed_registry_row(db, org_id, now, agent_id_raw, meta, discovery_status,
                      source, confidence, evidence=None):
    key = _asset_key(org_id, agent_id_raw)
    existing = db.query(AssetRegistry).filter(
        AssetRegistry.organization_id == org_id,
        AssetRegistry.asset_key == key,
    ).first()

    lifecycle  = meta.get("lifecycle", "unassigned")
    claimed_at = None
    if meta.get("claimed_days_ago"):
        claimed_at = now - timedelta(days=meta["claimed_days_ago"])

    # Build evidence — merge registry evidence with per-agent evidence
    evi = evidence or meta.get("evidence")

    fields = dict(
        agent_id_raw=agent_id_raw,
        agent_name=agent_id_raw,
        status=lifecycle,
        source=source,
        discovery_source=source,
        discovery_status=discovery_status,
        confidence_score=confidence,
        evidence=json.dumps(evi) if evi else None,
        owner=meta.get("owner"),
        team=meta.get("team"),
        environment=meta.get("env"),
        criticality=meta.get("criticality"),
        business_purpose=meta.get("business_purpose"),
        claimed_by=meta.get("owner"),
        claimed_at=claimed_at,
    )

    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
    else:
        db.add(AssetRegistry(
            organization_id=org_id,
            asset_key=key,
            first_seen_at=now - timedelta(days=random.randint(5, 90)),
            **fields,
        ))


def seed(clear=False):
    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    db = SessionLocal()

    try:
        org = db.query(Organization).first()
        if not org:
            print("No organisation found. Start the server once first, then re-run.")
            return

        org_id = org.id
        print(f"Seeding demo data for org '{org.name}' (id={org_id})\n")

        if clear:
            dt = db.query(Telemetry).filter(
                Telemetry.organization_id == org_id,
                Telemetry.prompt.like("[demo]%"),
            ).delete(synchronize_session=False)
            dr = db.query(AssetRegistry).filter(
                AssetRegistry.organization_id == org_id,
            ).delete(synchronize_session=False)
            db.commit()
            print(f"Cleared {dt} telemetry rows and {dr} registry rows.\n")

        now   = datetime.now(timezone.utc)
        total = 0

        # ── Gateway agents with explicit headers (verified, 95%) ──────────────
        print("Gateway agents — explicit headers (verified, 95% confidence):")
        for agent_id_raw, team, profile, version, env in GATEWAY_AGENTS:
            calls = make_calls(agent_id_raw, team, profile, org_id, now, version, env)
            for c in calls:
                db.add(c)
            total += len(calls)

            meta = GATEWAY_REGISTRY.get(agent_id_raw, {})
            evidence = {
                "resolution_method": "explicit_headers",
                "needs_admin_review": False,
                "evidence": [f"Explicit header: X-Agent-Name='{agent_id_raw}'"],
                **({"agent_version": version} if version else {}),
            }
            seed_registry_row(
                db, org_id, now,
                agent_id_raw=agent_id_raw,
                meta=meta,
                discovery_status="verified",
                source=meta.get("source", "gateway_telemetry"),
                confidence=meta.get("confidence", 95.0),
                evidence=evidence,
            )
            lifecycle = meta.get("lifecycle", "unassigned")
            print(f"  {agent_id_raw:<32} {team:<22} {lifecycle:<18} calls={len(calls)}")

        db.commit()

        # ── Auto-detected gateway agents (varied confidence) ──────────────────
        print(f"\nGateway agents — auto-detected (no explicit headers):")
        for (agent_id_raw, team, profile, version, env,
             resolution_method, confidence, lifecycle) in AUTO_DETECTED_AGENTS:

            calls = make_calls(agent_id_raw, team, profile, org_id, now, version, env)
            for c in calls:
                db.add(c)
            total += len(calls)

            meta = GATEWAY_REGISTRY.get(agent_id_raw, {})
            seed_registry_row(
                db, org_id, now,
                agent_id_raw=agent_id_raw,
                meta=meta,
                discovery_status="verified",
                source="gateway_telemetry",
                confidence=confidence,
                evidence=meta.get("evidence"),
            )
            print(f"  {agent_id_raw:<32} {team:<22} {lifecycle:<18} method={resolution_method:<20} confidence={confidence:.0f}%  calls={len(calls)}")

        db.commit()

        # ── Platform-discovered potential agents (registry only) ───────────────
        print(f"\nPlatform-discovered agents (potential, awaiting validation):")
        for pa in POTENTIAL_AGENTS:
            seed_registry_row(
                db, org_id, now,
                agent_id_raw=pa["agent_id_raw"],
                meta={"lifecycle": "unassigned", "team": pa["team"]},
                discovery_status="potential",
                source=pa["source"],
                confidence=pa["confidence"],
                evidence=pa["evidence"],
            )
            print(f"  {pa['agent_id_raw']:<32} {pa['team']:<22} source={pa['source']:<18} confidence={pa['confidence']:.0f}%")

        db.commit()

        # ── Summary ───────────────────────────────────────────────────────────
        n_managed    = sum(1 for a in GATEWAY_REGISTRY.values() if a.get("lifecycle") == "managed")
        n_unassigned = (sum(1 for a in GATEWAY_REGISTRY.values() if a.get("lifecycle") == "unassigned")
                        + sum(1 for _, _, _, _, _, _, _, lc in AUTO_DETECTED_AGENTS if lc == "unassigned"))
        n_needs_val  = sum(1 for _, _, _, _, _, _, _, lc in AUTO_DETECTED_AGENTS if lc == "needs_validation")
        n_retired    = sum(1 for a in GATEWAY_REGISTRY.values() if a.get("lifecycle") == "retired")

        by_method = {}
        for _, _, _, _, _, m, c, _ in AUTO_DETECTED_AGENTS:
            by_method.setdefault(m, []).append(c)

        print(f"""
Summary
───────────────────────────────────────────────────────────────
  Telemetry records            : {total}
  Gateway agents (explicit)    : {len(GATEWAY_AGENTS)} (verified, 95% confidence)
  Gateway agents (auto-detect) : {len(AUTO_DETECTED_AGENTS)} (verified, 15–75% confidence)
  Platform agents              : {len(POTENTIAL_AGENTS)} (potential, awaiting validation)

  Lifecycle breakdown
    Managed                    : {n_managed}
    Unassigned                 : {n_unassigned}
    Needs validation           : {n_needs_val}  ← auto-detected, admin review required
    Retired                    : {n_retired}

  Auto-detection methods used
    explicit_headers  : {len(GATEWAY_AGENTS):>3} agents  (95%)
    api_key_scope     : {len([a for a in AUTO_DETECTED_AGENTS if a[5]=='api_key_scope']):>3} agents  (75%)
    framework_metadata: {len([a for a in AUTO_DETECTED_AGENTS if a[5]=='framework_metadata']):>3} agents  (65%)
    request_origin    : {len([a for a in AUTO_DETECTED_AGENTS if a[5]=='request_origin']):>3} agents  (45%)
    fallback_hash     : {len([a for a in AUTO_DETECTED_AGENTS if a[5]=='fallback_hash']):>3} agents  (15%)

  Discovery sources (potential agents)
    gateway_telemetry : {sum(1 for a in GATEWAY_AGENTS) + len(AUTO_DETECTED_AGENTS):>3}
    github            : {sum(1 for p in POTENTIAL_AGENTS if p['source'] == 'github'):>3}
    cloud_functions   : {sum(1 for p in POTENTIAL_AGENTS if p['source'] == 'cloud_functions'):>3}
    n8n               : {sum(1 for p in POTENTIAL_AGENTS if p['source'] == 'n8n'):>3}
    slack             : {sum(1 for p in POTENTIAL_AGENTS if p['source'] == 'slack'):>3}
    jira              : {sum(1 for p in POTENTIAL_AGENTS if p['source'] == 'jira'):>3}
    mcp               : {sum(1 for p in POTENTIAL_AGENTS if p['source'] == 'mcp'):>3}
    servicenow        : {sum(1 for p in POTENTIAL_AGENTS if p['source'] == 'servicenow'):>3}
    azure_devops      : {sum(1 for p in POTENTIAL_AGENTS if p['source'] == 'azure_devops'):>3}

Open http://localhost:5173 and refresh.
""")

    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--clear", action="store_true", help="Wipe existing demo data first")
    args = parser.parse_args()
    seed(clear=args.clear)
