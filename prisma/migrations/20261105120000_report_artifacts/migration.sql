-- CreateTable
CREATE TABLE "report_artifacts" (
    "id" TEXT NOT NULL,
    "group_head_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "month_key" TEXT NOT NULL,
    "reporting_run_id" TEXT,
    "input_fingerprint" TEXT NOT NULL,
    "calc_json" JSONB NOT NULL,
    "pdf_path" TEXT,
    "pdf_sha256" TEXT,
    "engine" TEXT NOT NULL DEFAULT 'unknown',
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "created_by_name" TEXT,

    CONSTRAINT "report_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_artifacts_group_head_id_period_idx" ON "report_artifacts"("group_head_id", "period");

-- CreateIndex
CREATE INDEX "report_artifacts_period_idx" ON "report_artifacts"("period");

-- CreateIndex
CREATE UNIQUE INDEX "report_artifacts_group_head_id_period_input_fingerprint_key" ON "report_artifacts"("group_head_id", "period", "input_fingerprint");

-- AddForeignKey
ALTER TABLE "report_artifacts" ADD CONSTRAINT "report_artifacts_reporting_run_id_fkey" FOREIGN KEY ("reporting_run_id") REFERENCES "reporting_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
