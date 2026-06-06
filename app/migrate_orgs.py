"""
One-time migration: create the organizations table, seed the platform org,
and backfill every existing ApiKey and User to it.

Run once after deploying the new models:
    python -m app.migrate_orgs

Safe to run multiple times — idempotent.
"""
import logging
from app.database import engine, SessionLocal
from app.models import Base, Organization, ApiKey, User, ProviderCredential, Telemetry, Team as TeamModel, encrypt_credential
import os

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)


def _add_column_if_missing(conn, table: str, column: str, ddl_type: str) -> bool:
    """
    Add a column to an existing SQLite table if it isn't already there.
    Returns True if the column was added, False if it already existed.

    create_all() never alters existing tables, so columns added to a model
    after the table was first created must be applied with ALTER TABLE.
    SQLite supports ALTER TABLE ADD COLUMN (nullable, no default needed).
    """
    from sqlalchemy import text
    cols = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
    if column in cols:
        return False
    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
    log.info(f"  Added column {table}.{column}")
    return True


def run():
    # Create new tables (organizations, provider_credentials). This does NOT
    # add new columns to tables that already exist — those need ALTER TABLE below.
    Base.metadata.create_all(bind=engine)
    log.info("Tables created / verified.")

    # ── 0. Add organization_id columns to pre-BYOK tables ────────────────────
    # The persistent SQLite DB predates BYOK; its users/api_keys/telemetry tables
    # have no organization_id column. Add them before any ORM query touches them.
    with engine.begin() as conn:
        _add_column_if_missing(conn, "users",     "organization_id", "INTEGER REFERENCES organizations(id)")
        _add_column_if_missing(conn, "api_keys",  "organization_id", "INTEGER REFERENCES organizations(id)")
        _add_column_if_missing(conn, "telemetry", "organization_id", "INTEGER REFERENCES organizations(id)")

        # Rebuild roles table if it predates the id/created_at/organization_id columns.
        # The old schema had only (name, label, color, pages, can); the current ORM model
        # requires id PK + organization_id FK + created_at. SQLite can't ALTER PRIMARY KEY,
        # so we recreate the table and migrate the data.
        from sqlalchemy import text as _text
        roles_cols = {row[1] for row in conn.execute(_text("PRAGMA table_info(roles)"))}
        if "id" not in roles_cols:
            log.info("roles table missing 'id' column — rebuilding with full schema")
            conn.execute(_text("PRAGMA foreign_keys=OFF"))
            conn.execute(_text("""
                CREATE TABLE roles_new (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id),
                    name VARCHAR(64) NOT NULL,
                    label VARCHAR(64),
                    color VARCHAR(32),
                    pages TEXT DEFAULT '[]',
                    can TEXT DEFAULT '[]',
                    created_at DATETIME,
                    UNIQUE (organization_id, name)
                )
            """))
            # Copy rows; supply defaults for new columns
            conn.execute(_text("""
                INSERT INTO roles_new (organization_id, name, label, color, pages, can)
                SELECT
                    COALESCE(organization_id, 1),
                    name,
                    label,
                    color,
                    COALESCE(pages, '[]'),
                    COALESCE(can, '[]')
                FROM roles
            """))
            conn.execute(_text("DROP TABLE roles"))
            conn.execute(_text("ALTER TABLE roles_new RENAME TO roles"))
            conn.execute(_text("CREATE INDEX IF NOT EXISTS ix_roles_organization_id ON roles(organization_id)"))
            conn.execute(_text("CREATE INDEX IF NOT EXISTS ix_roles_name ON roles(name)"))
            conn.execute(_text("PRAGMA foreign_keys=ON"))
            log.info("roles table rebuilt successfully.")
        else:
            # Table exists with id — just ensure organization_id column is present
            _add_column_if_missing(conn, "roles", "organization_id", "INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id)")

        # Same fix for guard_modes — may be missing organization_id in old DBs.
        gm_cols = {row[1] for row in conn.execute(_text("PRAGMA table_info(guard_modes)"))}
        if "organization_id" not in gm_cols and gm_cols:
            log.info("guard_modes table missing 'organization_id' — adding column")
            conn.execute(_text("ALTER TABLE guard_modes ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id)"))
            conn.execute(_text("CREATE INDEX IF NOT EXISTS ix_guard_modes_organization_id ON guard_modes(organization_id)"))
            log.info("guard_modes.organization_id added.")

        # Same fix for teams table.
        teams_cols = {row[1] for row in conn.execute(_text("PRAGMA table_info(teams)"))}
        if "organization_id" not in teams_cols and teams_cols:
            log.info("teams table missing 'organization_id' — adding column")
            conn.execute(_text("ALTER TABLE teams ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id)"))
            conn.execute(_text("CREATE INDEX IF NOT EXISTS ix_teams_organization_id ON teams(organization_id)"))
            log.info("teams.organization_id added.")

    log.info("Column migration complete.")

    db = SessionLocal()
    try:
        # ── 1. Seed platform org ──────────────────────────────────────────────
        platform_org = db.query(Organization).filter(Organization.is_internal == True).first()  # noqa: E712
        if not platform_org:
            platform_org = Organization(
                name="Platform (internal)",
                slug="platform",
                is_internal=True,
            )
            db.add(platform_org)
            db.flush()
            log.info(f"Created platform org: id={platform_org.id} slug=platform")
        else:
            log.info(f"Platform org already exists: id={platform_org.id}")

        # ── 2. Seed platform org's provider credentials from env vars ────────
        #    Only seeded if the env vars exist and no credential is stored yet.
        for provider, env_var, base_url in [
            ("openai",    "OPENAI_API_KEY",    None),
            ("anthropic", "ANTHROPIC_API_KEY", None),
            ("google",    "GOOGLE_API_KEY",    None),
            ("local",     "LOCAL_LLM_URL",     None),
        ]:
            raw = os.getenv(env_var, "")
            if not raw or raw == "your-openai-api-key-here":
                continue
            existing = db.query(ProviderCredential).filter(
                ProviderCredential.organization_id == platform_org.id,
                ProviderCredential.provider == provider,
            ).first()
            if existing:
                log.info(f"  Provider credential already exists: org=platform provider={provider}")
                continue
            try:
                enc = encrypt_credential(raw)
                last4 = raw[-4:] if len(raw) >= 4 else raw
                cred = ProviderCredential(
                    organization_id=platform_org.id,
                    provider=provider,
                    encrypted_key=enc,
                    last4=last4,
                    base_url=base_url,
                )
                db.add(cred)
                log.info(f"  Seeded provider credential: org=platform provider={provider} last4=...{last4}")
            except RuntimeError as e:
                log.warning(f"  Cannot seed {provider} credential: {e}")

        # ── 3. Backfill existing ApiKeys → platform org ───────────────────────
        unset_keys = db.query(ApiKey).filter(ApiKey.organization_id == None).all()  # noqa: E711
        if unset_keys:
            for key in unset_keys:
                key.organization_id = platform_org.id
            log.info(f"Backfilled {len(unset_keys)} api_keys → platform org")
        else:
            log.info("All api_keys already have organization_id.")

        # ── 3b. Backfill teams table from existing api_keys ──────────────────────
        # API keys created before team-registration was added have a team name
        # but no corresponding row in the teams table. Seed them now so Guard
        # Modes shows all teams without requiring a proxy request first.
        seeded_teams = 0
        for key in db.query(ApiKey).filter(ApiKey.team != None, ApiKey.team != "", ApiKey.team != "unknown").all():  # noqa: E711
            if key.organization_id is None:
                continue
            exists = db.query(TeamModel).filter(
                TeamModel.organization_id == key.organization_id,
                TeamModel.name == key.team,
            ).first()
            if not exists:
                db.add(TeamModel(organization_id=key.organization_id, name=key.team))
                seeded_teams += 1
        if seeded_teams:
            log.info(f"Backfilled {seeded_teams} team(s) from existing api_keys.")
        else:
            log.info("Teams table already up-to-date from api_keys.")

        # ── 4. Backfill existing Users → platform org ─────────────────────────
        unset_users = db.query(User).filter(User.organization_id == None).all()  # noqa: E711
        if unset_users:
            for user in unset_users:
                user.organization_id = platform_org.id
            log.info(f"Backfilled {len(unset_users)} users → platform org")
        else:
            log.info("All users already have organization_id.")

        # ── 5. Backfill existing Telemetry rows → platform org ────────────────
        unset_tel = db.query(Telemetry).filter(Telemetry.organization_id == None).all()  # noqa: E711
        if unset_tel:
            for row in unset_tel:
                row.organization_id = platform_org.id
            log.info(f"Backfilled {len(unset_tel)} telemetry rows → platform org")
        else:
            log.info("All telemetry rows already have organization_id.")

        db.commit()

        # ── 6. Harden telemetry.organization_id to NOT NULL ──────────────────
        # SQLite doesn't support ALTER COLUMN, so we verify zero nulls remain
        # (post-backfill) and recreate the table with a NOT NULL constraint.
        # The check ensures we never harden with stranded null rows.
        from sqlalchemy import text, inspect as _inspect
        inspector = _inspect(engine)
        tel_cols = {c["name"]: c for c in inspector.get_columns("telemetry")}
        col_nullable = tel_cols.get("organization_id", {}).get("nullable", True)

        if col_nullable:
            null_count = db.execute(
                text("SELECT COUNT(*) FROM telemetry WHERE organization_id IS NULL")
            ).scalar()
            if null_count > 0:
                log.error(
                    "MIGRATION INCOMPLETE — telemetry.organization_id NOT hardened. "
                    f"{null_count} rows still have organization_id=NULL. "
                    "Tenancy isolation is NOT fully enforced. "
                    "Investigate which save path produced null rows, fix it, and redeploy."
                )
            else:
                # Rebuild the table with NOT NULL on organization_id.
                # All other columns are preserved exactly.
                db.execute(text("PRAGMA foreign_keys=OFF"))
                db.execute(text("""
                    CREATE TABLE telemetry_new (
                        id INTEGER NOT NULL PRIMARY KEY,
                        organization_id INTEGER NOT NULL REFERENCES organizations(id),
                        team VARCHAR(128) NOT NULL,
                        agent VARCHAR(128) NOT NULL,
                        model VARCHAR(64) NOT NULL,
                        prompt TEXT NOT NULL,
                        response TEXT NOT NULL,
                        prompt_tokens INTEGER DEFAULT 0,
                        completion_tokens INTEGER DEFAULT 0,
                        total_tokens INTEGER DEFAULT 0,
                        latency_ms FLOAT DEFAULT 0.0,
                        cost_usd FLOAT DEFAULT 0.0,
                        sensitive BOOLEAN DEFAULT 0,
                        sensitive_findings TEXT,
                        blocked BOOLEAN DEFAULT 0,
                        block_reason TEXT,
                        timestamp DATETIME
                    )
                """))
                db.execute(text("""
                    INSERT INTO telemetry_new
                    SELECT id, organization_id, team, agent, model, prompt, response,
                           prompt_tokens, completion_tokens, total_tokens, latency_ms,
                           cost_usd, sensitive, sensitive_findings, blocked, block_reason, timestamp
                    FROM telemetry
                """))
                db.execute(text("DROP TABLE telemetry"))
                db.execute(text("ALTER TABLE telemetry_new RENAME TO telemetry"))
                db.execute(text("CREATE INDEX IF NOT EXISTS ix_telemetry_id ON telemetry(id)"))
                db.execute(text("CREATE INDEX IF NOT EXISTS ix_telemetry_organization_id ON telemetry(organization_id)"))
                db.execute(text("PRAGMA foreign_keys=ON"))
                db.commit()
                log.info("Hardened telemetry.organization_id to NOT NULL.")
        else:
            log.info("telemetry.organization_id already NOT NULL.")

        log.info("Migration complete.")

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
