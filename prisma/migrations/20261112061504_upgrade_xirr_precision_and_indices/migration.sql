-- AlterTable
ALTER TABLE "master_cashflows" ALTER COLUMN "xirr" SET DATA TYPE DECIMAL(10,4);

-- CreateIndex
CREATE INDEX "master_cashflows_group_head_id_category_sub_category_transa_idx" ON "master_cashflows"("group_head_id", "category", "sub_category", "transaction_date");
