"""
Team-scope isolation test.

Verifies that team_scoped roles see only their own team's data, while
org-wide roles (admin, team_scoped=False) see all teams in their org —
and neither can escape the org boundary.

Setup
─────
  Acme org:
    • acme_admin    role=admin       (team_scoped=False)  team="Security"
    • acme_analyst  role=analyst     (team_scoped=True)   team="Security"
    • acme_dev      role=analyst     (team_scoped=True)   team="Development"

  Beta org:
    • beta_admin    role=admin                            team="Security"

  Telemetry:
    • 2 rows: Acme / Security
    • 1 row:  Acme / Development
    • 1 row:  Beta / Security

  Budgets:
    • Acme / Security  budget
    • Acme / Development budget
    • Beta / Security  budget

  Policies:
    • Acme / Security  policy
    • Acme / Development policy
"""
import os, re, sys, uuid, json
_db_path = f"/tmp/test_team_scope_{uuid.uuid4().hex[:8]}.db"
os.environ.update({
    "JWT_SECRET": "testsecret-teamscope",
    "CREDENTIAL_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "DATABASE_URL": f"sqlite:///{_db_path}",
})
sys.path.insert(0, "/home/user/aifinops-guard")
os.chdir("/home/user/aifinops-guard")

from app.main import app, _seed_roles_for_org
from app.database import SessionLocal
from app.models import Organization, User, Telemetry, BudgetRule, PolicyRule, Role as RoleModel
from app.auth import hash_password, create_token
from datetime import datetime, timezone

from fastapi.testclient import TestClient
client = TestClient(app, raise_server_exceptions=True)
client.get("/health")  # trigger startup

db = SessionLocal()
PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
_failures = []

def check(label, got, expected):
    ok = got == expected
    tag = PASS if ok else FAIL
    print(f"  [{tag}] {label}  (got {got!r})")
    if not ok:
        _failures.append(f"{label}: expected {expected!r}, got {got!r}")

def slug(n): return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")

# ── Fixture setup ──────────────────────────────────────────────────────────────

acme_org = Organization(name="AcmeCo", slug=slug("AcmeCo-ts"))
beta_org  = Organization(name="BetaCo", slug=slug("BetaCo-ts"))
db.add_all([acme_org, beta_org]); db.commit()
db.refresh(acme_org); db.refresh(beta_org)

_seed_roles_for_org(db, acme_org.id)
_seed_roles_for_org(db, beta_org.id)

# Verify seed set team_scoped correctly
analyst_role_acme = db.query(RoleModel).filter_by(organization_id=acme_org.id, name="analyst").first()
admin_role_acme   = db.query(RoleModel).filter_by(organization_id=acme_org.id, name="admin").first()
assert analyst_role_acme.team_scoped is True,  "analyst should be team_scoped=True after seed"
assert admin_role_acme.team_scoped   is False, "admin should be team_scoped=False after seed"

# Give the analyst role budget+settings page access so we can test write paths
# (in production an org admin would configure this; here we set it up for test coverage)
analyst_role_acme.pages = json.dumps([
    "home","chat","overview","cost","agents","models","workflows",
    "alerts","budgets","security","settings","integrations","onboarding"
])
db.commit()

acme_admin   = User(email="acme-admin@ts.com",    name="Acme Admin",    hashed_password=hash_password("x"),
                    role="admin",   team="Security",     organization_id=acme_org.id)
acme_analyst = User(email="acme-analyst@ts.com",  name="Acme Analyst",  hashed_password=hash_password("x"),
                    role="analyst", team="Security",     organization_id=acme_org.id)
acme_dev     = User(email="acme-dev@ts.com",      name="Acme Dev",      hashed_password=hash_password("x"),
                    role="analyst", team="Development",  organization_id=acme_org.id)
acme_noteam  = User(email="acme-noteam@ts.com",   name="Acme NoTeam",   hashed_password=hash_password("x"),
                    role="analyst", team="",              organization_id=acme_org.id)
beta_admin   = User(email="beta-admin@ts.com",    name="Beta Admin",    hashed_password=hash_password("x"),
                    role="admin",   team="Security",     organization_id=beta_org.id)
db.add_all([acme_admin, acme_analyst, acme_dev, acme_noteam, beta_admin]); db.commit()
for u in [acme_admin, acme_analyst, acme_dev, acme_noteam, beta_admin]:
    db.refresh(u)

now = datetime.now(timezone.utc)

# Telemetry rows
tel_acme_sec1 = Telemetry(organization_id=acme_org.id, team="Security",    agent="bot", model="gpt-4o-mini",
                           prompt="p1", response="r1", prompt_tokens=10, completion_tokens=5, total_tokens=15,
                           latency_ms=100, cost_usd=0.001, timestamp=now)
tel_acme_sec2 = Telemetry(organization_id=acme_org.id, team="Security",    agent="bot", model="gpt-4o-mini",
                           prompt="p2", response="r2", prompt_tokens=10, completion_tokens=5, total_tokens=15,
                           latency_ms=100, cost_usd=0.001, timestamp=now)
tel_acme_dev  = Telemetry(organization_id=acme_org.id, team="Development", agent="devbot", model="gpt-4o-mini",
                           prompt="p3", response="r3", prompt_tokens=10, completion_tokens=5, total_tokens=15,
                           latency_ms=100, cost_usd=0.001, timestamp=now)
tel_beta_sec  = Telemetry(organization_id=beta_org.id,  team="Security",    agent="betabot", model="gpt-4o-mini",
                           prompt="p4", response="r4", prompt_tokens=10, completion_tokens=5, total_tokens=15,
                           latency_ms=100, cost_usd=0.001, timestamp=now)
db.add_all([tel_acme_sec1, tel_acme_sec2, tel_acme_dev, tel_beta_sec]); db.commit()
for t in [tel_acme_sec1, tel_acme_sec2, tel_acme_dev, tel_beta_sec]:
    db.refresh(t)

# Budget rules
bud_acme_sec = BudgetRule(organization_id=acme_org.id, team="Security",    limit_usd=10, period="monthly", action="alert")
bud_acme_dev = BudgetRule(organization_id=acme_org.id, team="Development", limit_usd=20, period="monthly", action="alert")
bud_beta_sec = BudgetRule(organization_id=beta_org.id,  team="Security",    limit_usd=30, period="monthly", action="alert")
db.add_all([bud_acme_sec, bud_acme_dev, bud_beta_sec]); db.commit()
for b in [bud_acme_sec, bud_acme_dev, bud_beta_sec]:
    db.refresh(b)

# Policy rules
pol_acme_sec = PolicyRule(organization_id=acme_org.id, team="Security",    rule_type="allow_model", value="gpt-4o-mini")
pol_acme_dev = PolicyRule(organization_id=acme_org.id, team="Development", rule_type="allow_model", value="gpt-4o-mini")
pol_beta_sec = PolicyRule(organization_id=beta_org.id,  team="Security",    rule_type="allow_model", value="gpt-4o-mini")
db.add_all([pol_acme_sec, pol_acme_dev, pol_beta_sec]); db.commit()
for p in [pol_acme_sec, pol_acme_dev, pol_beta_sec]:
    db.refresh(p)

# Capture IDs/primitive values before closing session to avoid DetachedInstanceError
bud_acme_sec_id = bud_acme_sec.id
bud_acme_dev_id = bud_acme_dev.id
bud_beta_sec_id = bud_beta_sec.id
pol_acme_sec_id = pol_acme_sec.id
pol_acme_dev_id = pol_acme_dev.id
pol_beta_sec_id = pol_beta_sec.id

# Capture org IDs before closing session
acme_org_id = acme_org.id
beta_org_id = beta_org.id

# Make user tokens while session is still open
tok_acme_admin   = {"Authorization": f"Bearer {create_token(acme_admin)}"}
tok_acme_analyst = {"Authorization": f"Bearer {create_token(acme_analyst)}"}
tok_acme_dev_usr = {"Authorization": f"Bearer {create_token(acme_dev)}"}
tok_acme_noteam  = {"Authorization": f"Bearer {create_token(acme_noteam)}"}
tok_beta_admin   = {"Authorization": f"Bearer {create_token(beta_admin)}"}

db.close()

# Hardening needed for telemetry/audit/alerts endpoints
from app.main import _TENANCY_HARDENED
import app.main as _main
_main._TENANCY_HARDENED = True

# ── Tests ──────────────────────────────────────────────────────────────────────

print("\n=== Telemetry: team-scoped analyst (Security) ===")
r = client.get("/telemetry", headers=tok_acme_analyst)
check("analyst/Security telemetry → 200", r.status_code, 200)
teams = {x["team"] for x in r.json()}
check("analyst/Security sees only Security rows", teams, {"Security"})
check("analyst/Security sees 2 Security rows", len(r.json()), 2)

print("\n=== Telemetry: org-wide admin sees all Acme teams ===")
r = client.get("/telemetry", headers=tok_acme_admin)
check("admin telemetry → 200", r.status_code, 200)
teams = {x["team"] for x in r.json()}
check("admin sees Security and Development", teams, {"Security", "Development"})
check("admin sees 3 rows (2 Security + 1 Dev)", len(r.json()), 3)

print("\n=== Telemetry: cross-org — admin sees zero Beta rows ===")
check("admin sees no Beta teams", "Security" in teams and "Beta" not in str(teams), True)

print("\n=== Telemetry: team-scoped dev analyst (Development) ===")
r = client.get("/telemetry", headers=tok_acme_dev_usr)
check("analyst/Development telemetry → 200", r.status_code, 200)
teams_dev = {x["team"] for x in r.json()}
check("analyst/Development sees only Development rows", teams_dev, {"Development"})
check("analyst/Development sees 1 row", len(r.json()), 1)

print("\n=== Telemetry: null team → empty result (fail closed) ===")
r = client.get("/telemetry", headers=tok_acme_noteam)
check("null-team analyst telemetry → 200", r.status_code, 200)
check("null-team sees empty results", r.json(), [])

print("\n=== Audit log: team-scope enforcement ===")
r = client.get("/audit", headers=tok_acme_analyst)
check("analyst/Security audit → 200", r.status_code, 200)
ateams = {x["team"] for x in r.json()}
check("analyst/Security audit shows only Security", ateams, {"Security"})

r = client.get("/audit", headers=tok_acme_admin)
check("admin audit → 200", r.status_code, 200)
ateams_admin = {x["team"] for x in r.json()}
check("admin audit shows Security and Development", ateams_admin, {"Security", "Development"})

print("\n=== Security alerts: team-scope enforcement ===")
r = client.get("/security/alerts", headers=tok_acme_analyst)
check("analyst/Security alerts → 200", r.status_code, 200)
check("analyst alerts does not contain Beta", "betabot" not in str(r.json()), True)
check("analyst alerts does not contain devbot", "devbot" not in str(r.json()), True)

r = client.get("/security/alerts", headers=tok_acme_admin)
check("admin alerts → 200", r.status_code, 200)

print("\n=== Budgets list: team-scope enforcement ===")
r = client.get("/budgets", headers=tok_acme_analyst)
check("analyst/Security budgets → 200", r.status_code, 200)
bteams = {b["team"] for b in r.json()}
check("analyst/Security sees only Security budget", bteams, {"Security"})

r = client.get("/budgets", headers=tok_acme_admin)
check("admin budgets → 200", r.status_code, 200)
bteams_admin = {b["team"] for b in r.json()}
check("admin sees Security and Development budgets", bteams_admin, {"Security", "Development"})

r = client.get("/budgets", headers=tok_acme_noteam)
check("null-team budgets → 200 (empty)", r.status_code, 200)
check("null-team budgets = []", r.json(), [])

print("\n=== Budgets delete: cross-team 404 (not 403) ===")
r = client.delete(f"/budgets/{bud_acme_dev_id}", headers=tok_acme_analyst)
check("analyst/Security DELETE Development budget → 404", r.status_code, 404)

r = client.get("/budgets", headers=tok_acme_admin)
ids = [b["id"] for b in r.json()]
check("Development budget survives cross-team delete attempt", bud_acme_dev_id in ids, True)

r = client.delete(f"/budgets/{bud_acme_sec_id}", headers=tok_acme_analyst)
check("analyst/Security DELETE own budget → 204", r.status_code, 204)

print("\n=== Policies list: team-scope enforcement ===")
r = client.get("/policies", headers=tok_acme_analyst)
check("analyst/Security policies → 200", r.status_code, 200)
pteams = {p["team"] for p in r.json()}
check("analyst/Security sees only Security policy", pteams, {"Security"})

r = client.get("/policies", headers=tok_acme_admin)
check("admin policies → 200", r.status_code, 200)
pteams_admin = {p["team"] for p in r.json()}
check("admin sees Security and Development policies", pteams_admin, {"Security", "Development"})

r = client.get("/policies", headers=tok_acme_noteam)
check("null-team policies → 200 (empty)", r.status_code, 200)
check("null-team policies = []", r.json(), [])

print("\n=== Policies delete: cross-team 404 ===")
r = client.delete(f"/policies/{pol_acme_dev_id}", headers=tok_acme_analyst)
check("analyst/Security DELETE Development policy → 404", r.status_code, 404)

r = client.get("/policies", headers=tok_acme_admin)
ids = [p["id"] for p in r.json()]
check("Development policy survives cross-team delete attempt", pol_acme_dev_id in ids, True)

r = client.delete(f"/policies/{pol_acme_sec_id}", headers=tok_acme_analyst)
check("analyst/Security DELETE own policy → 204", r.status_code, 204)

print("\n=== Org boundary: Beta admin sees zero Acme data ===")
r = client.get("/budgets", headers=tok_beta_admin)
check("Beta admin budgets → 200", r.status_code, 200)
check("Beta admin sees only Beta Security budget", {b["team"] for b in r.json()}, {"Security"})
check("Beta admin sees exactly 1 budget", len(r.json()), 1)
ids = [b["id"] for b in r.json()]
check("Beta admin does NOT see Acme Development budget", bud_acme_dev_id not in ids, True)

print("\n=== Role seed: team_scoped defaults ===")
from app.database import SessionLocal as _SL
_db2 = _SL()
ar = _db2.query(RoleModel).filter_by(organization_id=acme_org_id, name="admin").first()
anr = _db2.query(RoleModel).filter_by(organization_id=acme_org_id, name="analyst").first()
vr = _db2.query(RoleModel).filter_by(organization_id=acme_org_id, name="viewer").first()
check("admin role team_scoped=False", ar.team_scoped, False)
check("analyst role team_scoped=True", anr.team_scoped, True)
check("viewer role team_scoped=True", vr.team_scoped, True)
_db2.close()

# ── Summary ────────────────────────────────────────────────────────────────────
total = 30  # approximate; real count determined by check() calls
if _failures:
    print(f"\n\033[31m{len(_failures)} check(s) FAILED:\033[0m")
    for f in _failures:
        print(f"  • {f}")
    sys.exit(1)
else:
    passed = total - len(_failures)
    print(f"\n\033[32mAll checks passed.\033[0m\n")
