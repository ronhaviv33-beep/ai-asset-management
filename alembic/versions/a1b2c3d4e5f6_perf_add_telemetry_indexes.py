"""perf: add missing indexes on telemetry and asset_registry hot-query columns

Revision ID: a1b2c3d4e5f6
Revises: 7b3e2f1a4c89
Create Date: 2026-06-24

Without these indexes every time-range query on telemetry is a full-table scan.
The composite (organization_id, timestamp) index is the single most important one
because almost every query filters on both columns.
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = '7b3e2f1a4c89'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── telemetry: most-queried columns ──────────────────────────────────────────
    # Composite (organization_id, timestamp) — hits the WHERE clause on every
    # time-range query: assets, cost, trends, security alerts, budget spend.
    op.create_index(
        'ix_telemetry_org_timestamp',
        'telemetry',
        ['organization_id', 'timestamp'],
    )
    # Composite (organization_id, is_demo, timestamp) — every query also filters
    # is_demo; the three-column index avoids a post-index scan on is_demo.
    op.create_index(
        'ix_telemetry_org_demo_timestamp',
        'telemetry',
        ['organization_id', 'is_demo', 'timestamp'],
    )
    # Single-column indexes for filter + GROUP BY selectivity
    op.create_index('ix_telemetry_timestamp', 'telemetry', ['timestamp'])
    op.create_index('ix_telemetry_agent',     'telemetry', ['agent'])
    op.create_index('ix_telemetry_team',      'telemetry', ['team'])
    op.create_index('ix_telemetry_model',     'telemetry', ['model'])
    op.create_index('ix_telemetry_blocked',   'telemetry', ['blocked'])
    op.create_index('ix_telemetry_sensitive', 'telemetry', ['sensitive'])
    op.create_index('ix_telemetry_is_demo',   'telemetry', ['is_demo'])

    # ── asset_registry: status filtering ─────────────────────────────────────────
    op.create_index('ix_asset_registry_status',     'asset_registry', ['status'])
    op.create_index('ix_asset_registry_asset_type', 'asset_registry', ['asset_type'])
    op.create_index(
        'ix_asset_registry_org_status',
        'asset_registry',
        ['organization_id', 'status'],
    )


def downgrade() -> None:
    op.drop_index('ix_asset_registry_org_status',   table_name='asset_registry')
    op.drop_index('ix_asset_registry_asset_type',   table_name='asset_registry')
    op.drop_index('ix_asset_registry_status',       table_name='asset_registry')
    op.drop_index('ix_telemetry_is_demo',           table_name='telemetry')
    op.drop_index('ix_telemetry_sensitive',         table_name='telemetry')
    op.drop_index('ix_telemetry_blocked',           table_name='telemetry')
    op.drop_index('ix_telemetry_model',             table_name='telemetry')
    op.drop_index('ix_telemetry_team',              table_name='telemetry')
    op.drop_index('ix_telemetry_agent',             table_name='telemetry')
    op.drop_index('ix_telemetry_timestamp',         table_name='telemetry')
    op.drop_index('ix_telemetry_org_demo_timestamp', table_name='telemetry')
    op.drop_index('ix_telemetry_org_timestamp',     table_name='telemetry')
