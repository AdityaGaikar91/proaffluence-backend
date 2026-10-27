-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('Pending', 'Approved', 'Rejected/Returned');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('Purchase', 'Redemption');

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('MF', 'PMS', 'Stocks', 'Equity', 'Debt', 'Other');

-- CreateEnum
CREATE TYPE "BenchmarkCode" AS ENUM ('NIFTY_50_TRI', 'NIFTY_50_PR', 'BSE_500', 'SENSEX');

-- CreateEnum
CREATE TYPE "BenchmarkReturnType" AS ENUM ('TRI', 'PR');

-- CreateEnum
CREATE TYPE "QuoteSource" AS ENUM ('feed', 'manual', 'bulk_upload');

-- CreateEnum
CREATE TYPE "EmailCampaignStatus" AS ENUM ('Draft', 'Ready', 'Approved', 'Queued', 'Sent', 'Delivered', 'Failed', 'Bounced');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('Created', 'Corrected', 'Voided', 'Approved', 'Returned', 'Imported', 'Frozen', 'Unfrozen');

-- CreateTable
CREATE TABLE "group_heads" (
    "id" TEXT NOT NULL,
    "custom_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "email" TEXT NOT NULL,
    "secondary_email" TEXT,
    "inception_date" TEXT NOT NULL,
    "pan" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "notes" TEXT,
    "categories" "AssetCategory"[],
    "totalAum" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netInvestment" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_heads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" TEXT NOT NULL,
    "group_head_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "pan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_cashflows" (
    "id" TEXT NOT NULL,
    "sr_no" INTEGER NOT NULL,
    "date_of_entry" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "client_owner" TEXT NOT NULL,
    "group_head_id" TEXT NOT NULL,
    "group_head_name" TEXT NOT NULL,
    "family_member_id" TEXT,
    "family_member_name" TEXT NOT NULL,
    "transaction_date" TEXT NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "sub_category" TEXT NOT NULL,
    "amounts" DECIMAL(18,2) NOT NULL,
    "newInvestments" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "profitLoss" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "xirr" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "void_reason" TEXT,
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
    "return_reason" TEXT,
    "submitted_by_id" TEXT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" TEXT,
    "approved_by_name" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_cashflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closing_balances" (
    "id" TEXT NOT NULL,
    "sr_no" INTEGER NOT NULL,
    "date_of_entry" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month_key" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "group_head_id" TEXT NOT NULL,
    "group_head_name" TEXT NOT NULL,
    "family_member_id" TEXT,
    "family_member_name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "sub_category" TEXT NOT NULL,
    "closing_amount" DECIMAL(18,2),
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
    "return_reason" TEXT,
    "submitted_by_id" TEXT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" TEXT,
    "approved_by_name" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "closing_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmarks" (
    "code" "BenchmarkCode" NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "return_type" "BenchmarkReturnType" NOT NULL,
    "exchange" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "methodology_label" TEXT NOT NULL,

    CONSTRAINT "benchmarks_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "indices_data_records" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "index_code" "BenchmarkCode" NOT NULL,
    "closing_value" DECIMAL(14,4) NOT NULL,
    "source" "QuoteSource" NOT NULL DEFAULT 'feed',
    "updated_by" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indices_data_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hybrid_allocation_rules" (
    "id" TEXT NOT NULL,
    "scheme_name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL DEFAULT 'MF',
    "equity_ratio" INTEGER NOT NULL DEFAULT 50,
    "debt_ratio" INTEGER NOT NULL DEFAULT 50,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hybrid_allocation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_runs" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "month_key" TEXT NOT NULL,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozen_at" TIMESTAMP(3),
    "frozen_by_id" TEXT,
    "frozen_by_name" TEXT,
    "unfrozen_at" TIMESTAMP(3),
    "unfrozen_by_id" TEXT,
    "unfreeze_reason" TEXT,
    "calculation_status" TEXT NOT NULL DEFAULT 'idle',
    "last_calculated_at" TIMESTAMP(3),
    "calculation_summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reporting_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" TEXT NOT NULL,
    "group_head_id" TEXT NOT NULL,
    "report_date" TEXT NOT NULL,
    "status" "EmailCampaignStatus" NOT NULL DEFAULT 'Draft',
    "approved_by_id" TEXT,
    "approved_by_name" TEXT,
    "approved_at" TIMESTAMP(3),
    "queued_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "bounce_code" TEXT,
    "provider_message_id" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_logs" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "group_head_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "attachment_filename" TEXT NOT NULL,
    "status" "EmailCampaignStatus" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "failure_reason" TEXT,
    "bounce_code" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_trails" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "reason" TEXT,
    "changes" JSONB,
    "cashflow_id" TEXT,
    "balance_id" TEXT,
    "reporting_run_id" TEXT,

    CONSTRAINT "audit_trails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_heads_custom_id_key" ON "group_heads"("custom_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_members_group_head_id_name_key" ON "family_members"("group_head_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "master_cashflows_sr_no_key" ON "master_cashflows"("sr_no");

-- CreateIndex
CREATE INDEX "master_cashflows_month_idx" ON "master_cashflows"("month");

-- CreateIndex
CREATE INDEX "master_cashflows_group_head_id_idx" ON "master_cashflows"("group_head_id");

-- CreateIndex
CREATE INDEX "master_cashflows_approval_status_idx" ON "master_cashflows"("approval_status");

-- CreateIndex
CREATE INDEX "master_cashflows_transaction_date_idx" ON "master_cashflows"("transaction_date");

-- CreateIndex
CREATE INDEX "closing_balances_month_key_idx" ON "closing_balances"("month_key");

-- CreateIndex
CREATE INDEX "closing_balances_approval_status_idx" ON "closing_balances"("approval_status");

-- CreateIndex
CREATE UNIQUE INDEX "closing_balances_month_key_group_head_id_family_member_name_key" ON "closing_balances"("month_key", "group_head_id", "family_member_name", "category", "sub_category");

-- CreateIndex
CREATE INDEX "indices_data_records_date_idx" ON "indices_data_records"("date");

-- CreateIndex
CREATE UNIQUE INDEX "indices_data_records_date_index_code_key" ON "indices_data_records"("date", "index_code");

-- CreateIndex
CREATE UNIQUE INDEX "hybrid_allocation_rules_scheme_name_key" ON "hybrid_allocation_rules"("scheme_name");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_runs_period_key" ON "reporting_runs"("period");

-- CreateIndex
CREATE INDEX "email_campaigns_status_idx" ON "email_campaigns"("status");

-- CreateIndex
CREATE UNIQUE INDEX "email_campaigns_group_head_id_report_date_key" ON "email_campaigns"("group_head_id", "report_date");

-- CreateIndex
CREATE INDEX "delivery_logs_campaign_id_idx" ON "delivery_logs"("campaign_id");

-- CreateIndex
CREATE INDEX "delivery_logs_recipient_email_idx" ON "delivery_logs"("recipient_email");

-- CreateIndex
CREATE INDEX "audit_trails_cashflow_id_idx" ON "audit_trails"("cashflow_id");

-- CreateIndex
CREATE INDEX "audit_trails_balance_id_idx" ON "audit_trails"("balance_id");

-- CreateIndex
CREATE INDEX "audit_trails_reporting_run_id_idx" ON "audit_trails"("reporting_run_id");

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_group_head_id_fkey" FOREIGN KEY ("group_head_id") REFERENCES "group_heads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_cashflows" ADD CONSTRAINT "master_cashflows_group_head_id_fkey" FOREIGN KEY ("group_head_id") REFERENCES "group_heads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_cashflows" ADD CONSTRAINT "master_cashflows_family_member_id_fkey" FOREIGN KEY ("family_member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_cashflows" ADD CONSTRAINT "master_cashflows_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_cashflows" ADD CONSTRAINT "master_cashflows_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_balances" ADD CONSTRAINT "closing_balances_group_head_id_fkey" FOREIGN KEY ("group_head_id") REFERENCES "group_heads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_balances" ADD CONSTRAINT "closing_balances_family_member_id_fkey" FOREIGN KEY ("family_member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_balances" ADD CONSTRAINT "closing_balances_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_balances" ADD CONSTRAINT "closing_balances_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indices_data_records" ADD CONSTRAINT "indices_data_records_index_code_fkey" FOREIGN KEY ("index_code") REFERENCES "benchmarks"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_runs" ADD CONSTRAINT "reporting_runs_frozen_by_id_fkey" FOREIGN KEY ("frozen_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_runs" ADD CONSTRAINT "reporting_runs_unfrozen_by_id_fkey" FOREIGN KEY ("unfrozen_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_group_head_id_fkey" FOREIGN KEY ("group_head_id") REFERENCES "group_heads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_trails" ADD CONSTRAINT "audit_trails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_trails" ADD CONSTRAINT "audit_trails_cashflow_id_fkey" FOREIGN KEY ("cashflow_id") REFERENCES "master_cashflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_trails" ADD CONSTRAINT "audit_trails_balance_id_fkey" FOREIGN KEY ("balance_id") REFERENCES "closing_balances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_trails" ADD CONSTRAINT "audit_trails_reporting_run_id_fkey" FOREIGN KEY ("reporting_run_id") REFERENCES "reporting_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
