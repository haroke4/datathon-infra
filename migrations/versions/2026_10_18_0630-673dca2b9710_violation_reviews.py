"""Store reviewer decisions separately from analysis results."""

import sqlalchemy as sa
from alembic import op

revision = "673dca2b9710"
down_revision = "1bebe03a4446"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "violation_reviews",
        sa.Column("job_id", sa.String(32), nullable=False),
        sa.Column("violation_index", sa.Integer(), nullable=False),
        sa.Column("violation_key", sa.String(64), nullable=False),
        sa.Column("decision", sa.String(24), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("job_id", "violation_index"),
        sa.CheckConstraint("violation_index >= 0", name="ck_violation_review_index"),
        sa.CheckConstraint(
            "decision IN ('pending', 'confirmed', 'insufficient_data', 'rejected')",
            name="ck_violation_review_decision",
        ),
    )


def downgrade() -> None:
    op.drop_table("violation_reviews")
