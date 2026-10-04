"""Add zone-linked detection events and risk score history."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261004_02"
down_revision = "20261004_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    if "detection_events" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("detection_events")}
        if "zone_id" not in columns:
            with op.batch_alter_table("detection_events") as batch_op:
                batch_op.add_column(
                    sa.Column(
                        "zone_id",
                        sa.Integer(),
                        sa.ForeignKey("zones.id", ondelete="SET NULL", name="fk_detection_events_zone_id_zones"),
                        nullable=True,
                    )
                )
    if "risk_score_history" not in inspect(connection).get_table_names():
        op.create_table(
            "risk_score_history",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("zone_id", sa.Integer(), sa.ForeignKey("zones.id", ondelete="CASCADE"), nullable=False),
            sa.Column("score", sa.Integer(), nullable=False),
            sa.Column("trend", sa.String(length=20), nullable=False),
            sa.Column("velocity", sa.Float(), nullable=False),
            sa.Column("projected_score", sa.Integer(), nullable=False),
            sa.Column("explanation", sa.String(length=500), nullable=False),
            sa.Column("is_simulated", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_risk_score_history_zone_id", "risk_score_history", ["zone_id"])
        op.create_index("ix_risk_score_history_recorded_at", "risk_score_history", ["recorded_at"])


def downgrade() -> None:
    connection = op.get_bind()
    if "risk_score_history" in inspect(connection).get_table_names():
        op.drop_index("ix_risk_score_history_recorded_at", table_name="risk_score_history")
        op.drop_index("ix_risk_score_history_zone_id", table_name="risk_score_history")
        op.drop_table("risk_score_history")
    if "detection_events" in inspect(connection).get_table_names():
        columns = {column["name"] for column in inspect(connection).get_columns("detection_events")}
        if "zone_id" in columns:
            with op.batch_alter_table("detection_events") as batch_op:
                batch_op.drop_column("zone_id")
