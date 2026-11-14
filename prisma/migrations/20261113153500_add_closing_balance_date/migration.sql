-- AlterTable: Add closing_balance_date column to closing_balances
ALTER TABLE "closing_balances" ADD COLUMN "closing_balance_date" TEXT;

-- CreateIndex: Add index for closing_balance_date to support UI date filtering and table sorting
CREATE INDEX "closing_balances_closing_balance_date_idx" ON "closing_balances"("closing_balance_date");

-- Deterministic backfill for existing rows
UPDATE "closing_balances"
SET "closing_balance_date" = 
  CASE 
    WHEN "date_of_entry" IS NOT NULL 
      AND substring("date_of_entry" from 4 for 7) = (substring("month_key" from 6 for 2) || '-' || substring("month_key" from 1 for 4))
    THEN "date_of_entry"
    WHEN "month_key" ~ '^\d{4}-(0[1-9]|1[0-2])$'
    THEN '01-' || substring("month_key" from 6 for 2) || '-' || substring("month_key" from 1 for 4)
    ELSE "date_of_entry"
  END
WHERE "closing_balance_date" IS NULL;
