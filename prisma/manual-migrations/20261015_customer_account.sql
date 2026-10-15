-- Additive customer financial history, identity review and credit approval.
-- No existing Customers, Orders or Payments data is rewritten by this migration.
BEGIN;

-- CreateTable
CREATE TABLE "CustomerFinanceLink" (
    "id" UUID NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "external_customer_id" UUID NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFinanceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFinanceRevision" (
    "customer_id" INTEGER NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerFinanceRevision_pkey" PRIMARY KEY ("customer_id","environment")
);

-- CreateTable
CREATE TABLE "CustomerFinanceEntry" (
    "id" UUID NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "entry_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "purchase_id" UUID,
    "deposit_id" UUID,
    "payment_id" INTEGER,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFinanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFinancePurchase" (
    "id" UUID NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "external_customer_id" UUID NOT NULL,
    "external_order_id" UUID NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "amount_cents" INTEGER NOT NULL,
    "reserved_cents" INTEGER NOT NULL DEFAULT 0,
    "cash_applied_cents" INTEGER NOT NULL DEFAULT 0,
    "balance_before_cents" INTEGER NOT NULL,
    "projected_balance_cents" INTEGER NOT NULL,
    "consented_projected_balance_cents" INTEGER NOT NULL,
    "requires_approval" BOOLEAN NOT NULL,
    "order_snapshot" JSONB NOT NULL,
    "core_order_id" INTEGER,
    "reason" TEXT,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFinancePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFinanceDeposit" (
    "id" UUID NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "external_customer_id" UUID NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "amount_cents" INTEGER NOT NULL,
    "deposited_at" TIMESTAMP(3),
    "reference" TEXT,
    "invoice_id" TEXT,
    "bank_entry_id" UUID,
    "boleto_url" TEXT,
    "digitable" TEXT,
    "invoice_payload" JSONB,
    "last_error" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFinanceDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFinanceBankEntry" (
    "id" UUID NOT NULL,
    "connection_key" TEXT NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "remote_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "transaction_type" TEXT,
    "transaction_id" TEXT,
    "counterparty_document" TEXT,
    "counterparty_name" TEXT,
    "description" TEXT,
    "authenticated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFinanceBankEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerFinanceLink_status_environment_idx" ON "CustomerFinanceLink"("status", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinanceLink_external_customer_id_environment_key" ON "CustomerFinanceLink"("external_customer_id", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinanceEntry_entry_key_key" ON "CustomerFinanceEntry"("entry_key");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinanceEntry_deposit_id_key" ON "CustomerFinanceEntry"("deposit_id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinanceEntry_payment_id_key" ON "CustomerFinanceEntry"("payment_id");

-- CreateIndex
CREATE INDEX "CustomerFinanceEntry_customer_id_environment_created_at_idx" ON "CustomerFinanceEntry"("customer_id", "environment", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinancePurchase_idempotency_key_key" ON "CustomerFinancePurchase"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinancePurchase_core_order_id_key" ON "CustomerFinancePurchase"("core_order_id");

-- CreateIndex
CREATE INDEX "CustomerFinancePurchase_status_environment_created_at_idx" ON "CustomerFinancePurchase"("status", "environment", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinancePurchase_external_order_id_environment_key" ON "CustomerFinancePurchase"("external_order_id", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinanceDeposit_idempotency_key_key" ON "CustomerFinanceDeposit"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinanceDeposit_invoice_id_key" ON "CustomerFinanceDeposit"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinanceDeposit_bank_entry_id_key" ON "CustomerFinanceDeposit"("bank_entry_id");

-- CreateIndex
CREATE INDEX "CustomerFinanceDeposit_environment_status_created_at_idx" ON "CustomerFinanceDeposit"("environment", "status", "created_at");

-- CreateIndex
CREATE INDEX "CustomerFinanceBankEntry_environment_occurred_at_idx" ON "CustomerFinanceBankEntry"("environment", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFinanceBankEntry_connection_key_remote_id_key" ON "CustomerFinanceBankEntry"("connection_key", "remote_id");

-- AddForeignKey
ALTER TABLE "CustomerFinanceLink" ADD CONSTRAINT "CustomerFinanceLink_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinanceRevision" ADD CONSTRAINT "CustomerFinanceRevision_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinanceEntry" ADD CONSTRAINT "CustomerFinanceEntry_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinanceEntry" ADD CONSTRAINT "CustomerFinanceEntry_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "CustomerFinancePurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinanceEntry" ADD CONSTRAINT "CustomerFinanceEntry_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "CustomerFinanceDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinanceEntry" ADD CONSTRAINT "CustomerFinanceEntry_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancePurchase" ADD CONSTRAINT "CustomerFinancePurchase_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinancePurchase" ADD CONSTRAINT "CustomerFinancePurchase_core_order_id_fkey" FOREIGN KEY ("core_order_id") REFERENCES "Orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinanceDeposit" ADD CONSTRAINT "CustomerFinanceDeposit_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFinanceDeposit" ADD CONSTRAINT "CustomerFinanceDeposit_bank_entry_id_fkey" FOREIGN KEY ("bank_entry_id") REFERENCES "CustomerFinanceBankEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "CustomerFinanceLink" ADD CONSTRAINT "CustomerFinanceLink_status_check" CHECK (status IN ('PENDING','APPROVED','REJECTED'));
CREATE UNIQUE INDEX "CustomerFinanceLink_one_approved_customer" ON "CustomerFinanceLink" (customer_id,environment) WHERE status='APPROVED';
ALTER TABLE "CustomerFinancePurchase" ADD CONSTRAINT "CustomerFinancePurchase_amount_check" CHECK (amount_cents > 0 AND reserved_cents >= 0 AND reserved_cents <= amount_cents AND cash_applied_cents >= 0 AND cash_applied_cents <= amount_cents);
ALTER TABLE "CustomerFinancePurchase" ADD CONSTRAINT "CustomerFinancePurchase_status_check" CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED') AND (status='PENDING' OR reserved_cents=0));
ALTER TABLE "CustomerFinanceDeposit" ADD CONSTRAINT "CustomerFinanceDeposit_amount_check" CHECK (amount_cents > 0);
ALTER TABLE "CustomerFinanceDeposit" ADD CONSTRAINT "CustomerFinanceDeposit_status_check" CHECK (status IN ('PENDING','OPEN','UNKNOWN','CREDITED','REJECTED') AND kind IN ('BANK_CLAIM','BOLETO'));
ALTER TABLE "CustomerFinanceBankEntry" ADD CONSTRAINT "CustomerFinanceBankEntry_credit_check" CHECK (amount_cents > 0 AND type='CREDIT');
COMMIT;
