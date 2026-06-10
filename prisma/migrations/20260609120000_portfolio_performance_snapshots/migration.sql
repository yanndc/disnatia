-- Snapshots versionnés des indicateurs performance (Phase C)
CREATE TABLE "portfolio_performance_snapshots" (
    "id" TEXT NOT NULL,
    "session_date" DATE NOT NULL,
    "calc_version" INTEGER NOT NULL,
    "period_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "owner" TEXT,
    "scope_preset" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "short_label" TEXT NOT NULL,
    "gain_cad" DOUBLE PRECISION,
    "gain_pct" DOUBLE PRECISION,
    "current_cad" DOUBLE PRECISION NOT NULL,
    "baseline_cad" DOUBLE PRECISION,
    "baseline_date" TEXT,
    "period_start" TEXT,
    "period_end" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "accounts_included" INTEGER NOT NULL,
    "accounts_with_baseline" INTEGER NOT NULL,
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "annualized" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_performance_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_performance_snapshots_session_date_calc_version_period_id_scope_key_key" ON "portfolio_performance_snapshots"("session_date", "calc_version", "period_id", "scope_key");

CREATE INDEX "portfolio_performance_snapshots_session_date_calc_version_idx" ON "portfolio_performance_snapshots"("session_date", "calc_version");

CREATE INDEX "portfolio_performance_snapshots_scope_key_idx" ON "portfolio_performance_snapshots"("scope_key");
