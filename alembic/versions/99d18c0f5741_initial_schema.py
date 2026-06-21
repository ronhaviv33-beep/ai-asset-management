"""initial_schema

Revision ID: 99d18c0f5741
Revises:
Create Date: 2026-06-21 14:12:23.854013

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '99d18c0f5741'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Baseline snapshot of the initial schema.

    All tables were created by SQLAlchemy's create_all() and ad-hoc ALTER TABLE
    calls before Alembic was introduced.  On startup, app/main.py stamps this
    revision via ``alembic stamp head`` for any DB that already has the tables
    but no alembic_version row, so this migration never actually runs against
    an existing database.

    Future schema changes should be added as new migrations on top of this one.
    """
    pass


def downgrade() -> None:
    """No-op — this is the root baseline migration."""
    pass
