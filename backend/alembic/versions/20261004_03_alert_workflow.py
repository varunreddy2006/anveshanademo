"""Add alert assignment, notes, and action audit details."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261004_03"
down_revision = "20261004_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    if "safety_alerts" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("safety_alerts")}
        with op.batch_alter_table("safety_alerts") as batch_op:
            if "assigned_user_id" not in columns:
                batch_op.add_column(sa.Column("assigned_user_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_safety_alerts_assigned_user_id_users",
                    "users",
                    ["assigned_user_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
            if "status" in columns:
                batch_op.alter_column("status", existing_type=sa.String(length=30), server_default="New")
        connection.execute(sa.text("UPDATE safety_alerts SET status = 'New' WHERE status = 'Open'"))
    if "audit_logs" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("audit_logs")}
        if "details" not in columns:
            op.add_column("audit_logs", sa.Column("details", sa.String(length=500), nullable=True))
    if "alert_notes" not in inspect(connection).get_table_names():
        op.create_table(
            "alert_notes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("alert_id", sa.Integer(), sa.ForeignKey("safety_alerts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("note", sa.String(length=2000), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_alert_notes_alert_id", "alert_notes", ["alert_id"])


def downgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    if "alert_notes" in inspector.get_table_names():
        op.drop_index("ix_alert_notes_alert_id", table_name="alert_notes")
        op.drop_table("alert_notes")
    if "audit_logs" in inspect(connection).get_table_names():
        columns = {column["name"] for column in inspect(connection).get_columns("audit_logs")}
        if "details" in columns:
            op.drop_column("audit_logs", "details")
    if "safety_alerts" in inspect(connection).get_table_names():
        columns = {column["name"] for column in inspect(connection).get_columns("safety_alerts")}
        if "assigned_user_id" in columns:
            with op.batch_alter_table("safety_alerts") as batch_op:
                batch_op.drop_constraint("fk_safety_alerts_assigned_user_id_users", type_="foreignkey")
                batch_op.drop_column("assigned_user_id")
