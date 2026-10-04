"""Add zone type to existing zones.

Revision ID: 20261004_01
Revises:
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261004_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    columns = {column["name"] for column in inspect(connection).get_columns("zones")}
    if "zone_type" not in columns:
        op.add_column(
            "zones",
            sa.Column("zone_type", sa.String(length=32), server_default="normal", nullable=False),
        )


def downgrade() -> None:
    connection = op.get_bind()
    columns = {column["name"] for column in inspect(connection).get_columns("zones")}
    if "zone_type" in columns:
        with op.batch_alter_table("zones") as batch_op:
            batch_op.drop_column("zone_type")
