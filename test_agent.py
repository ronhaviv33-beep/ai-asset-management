"""
Test agent that triggers two alert types:
  1. Looping agents   — >5 calls from same agent in a 30-min window
  2. Sensitive data exposure — prompts containing PII / secrets

Usage:
  python test_agent.py --url https://aifinops-backend.onrender.com
"""

import argparse
import time
import requests

API_KEY = "gk-PkdKHCmt9F6SiLrI9rruHkTCBK-dz8n7SGelbl2zqMQ"
TEAM    = "Developer"
AGENT   = "test-loop-agent"

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type":  "application/json",
    "X-Guard-Team":  TEAM,
    "X-Guard-Agent": AGENT,
}

# ── Sensitive payloads (each triggers at least one PII/secret pattern) ────────
SENSITIVE_PROMPTS = [
    # SSN (critical)
    "Process this employee record: John Doe, SSN 123-45-6789, hired 2023-01-15.",
    # Credit card (high)
    "Charge the card 4111 1111 1111 1111 for the order and confirm.",
    # Email + phone (medium)
    "Send a follow-up to alice@example.com or call her at +1 (555) 867-5309.",
    # AWS key (critical)
    "The deployment uses AKIAIOSFODNN7EXAMPLE for S3 access — rotate it ASAP.",
    # IBAN (high)
    "Wire the refund to GB29NWBK60161331926819 before end of day.",
]

# ── Loop payload (cheap, fast, no real LLM call needed) ──────────────────────
LOOP_PROMPT = "ping"


def call(url: str, prompt: str) -> tuple[int, str]:
    body = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
    }
    try:
        r = requests.post(f"{url}/v1/chat/completions", json=body,
                          headers=HEADERS, timeout=20)
        return r.status_code, r.text[:120]
    except Exception as e:
        return 0, str(e)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://aifinops-backend.onrender.com",
                        help="Backend base URL")
    parser.add_argument("--loops", type=int, default=8,
                        help="Number of loop calls (>5 triggers alert)")
    args = parser.parse_args()

    url = args.url.rstrip("/")
    print(f"\n── Backend: {url}")
    print(f"── Team:    {TEAM}  |  Agent: {AGENT}\n")

    # ── Phase 1: Sensitive data exposure ─────────────────────────────────────
    print("=== Phase 1: Sensitive data exposure ===")
    for i, prompt in enumerate(SENSITIVE_PROMPTS, 1):
        status, body = call(url, prompt)
        tag = "[ok]" if status in (200, 201) else f"[{status}]"
        print(f"  {tag} sensitive call {i}/{len(SENSITIVE_PROMPTS)}: "
              f"{prompt[:60]}…")
        time.sleep(0.4)

    # ── Phase 2: Looping agent ────────────────────────────────────────────────
    print(f"\n=== Phase 2: Looping agent ({args.loops} calls in quick succession) ===")
    for i in range(1, args.loops + 1):
        status, body = call(url, LOOP_PROMPT)
        tag = "[ok]" if status in (200, 201) else f"[{status}]"
        print(f"  {tag} loop call {i}/{args.loops}")
        time.sleep(0.2)

    print("\n── Done. Refresh the Security / Alerts page in the dashboard.")
    print("   Expected alerts:")
    print("   • sensitive_data_exposure  (critical)")
    print("   • repeated_agent_loop      (critical)")


if __name__ == "__main__":
    main()
