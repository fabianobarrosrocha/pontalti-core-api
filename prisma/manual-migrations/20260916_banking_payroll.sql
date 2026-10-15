-- Additive banking/payroll migration. Apply once, before deploying the API.
BEGIN;

-- CreateEnum
CREATE TYPE "BankEnvironment" AS ENUM ('STAGE', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "PayrollKind" AS ENUM ('SALARY', 'ADVANCE', 'VACATION', 'BONUS');

-- CreateEnum
CREATE TYPE "BankTransferStatus" AS ENUM ('DRAFT', 'QUEUED', 'SUBMITTING', 'INITIATED', 'SCHEDULED', 'COMPLETED', 'REJECTED', 'FAILED', 'UNKNOWN', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "BankEmployeeAccount" (
    "employee_id" INTEGER NOT NULL,
    "bank_code" VARCHAR(3) NOT NULL,
    "branch_number" VARCHAR(4) NOT NULL,
    "account_number" VARCHAR(13) NOT NULL,
    "account_type" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankEmployeeAccount_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "BankPayrollRun" (
    "id" UUID NOT NULL,
    "competence" VARCHAR(7) NOT NULL,
    "kind" "PayrollKind" NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "connection_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "submit_at" TIMESTAMP(3) NOT NULL,
    "auto_submit_to_cora" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankPayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransfer" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "connection_key" TEXT NOT NULL,
    "beneficiary_name" TEXT NOT NULL,
    "destination" JSONB NOT NULL,
    "account_version" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "status" "BankTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "remote_id" TEXT,
    "remote_status" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "lease_until" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "expense_id" INTEGER,
    "reversal_expense_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAuditEvent" (
    "id" UUID NOT NULL,
    "run_id" UUID,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankWebhookEvent" (
    "id" UUID NOT NULL,
    "connection_key" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "BankWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankPayrollRun_auto_submit_to_cora_paused_submit_at_idx" ON "BankPayrollRun"("auto_submit_to_cora", "paused", "submit_at");

-- CreateIndex
CREATE UNIQUE INDEX "BankPayrollRun_connection_key_competence_kind_key" ON "BankPayrollRun"("connection_key", "competence", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransfer_idempotency_key_key" ON "BankTransfer"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransfer_expense_id_key" ON "BankTransfer"("expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransfer_reversal_expense_id_key" ON "BankTransfer"("reversal_expense_id");

-- CreateIndex
CREATE INDEX "BankTransfer_status_lease_until_idx" ON "BankTransfer"("status", "lease_until");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransfer_run_id_employee_id_key" ON "BankTransfer"("run_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransfer_connection_key_remote_id_key" ON "BankTransfer"("connection_key", "remote_id");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_run_id_created_at_idx" ON "FinancialAuditEvent"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "BankWebhookEvent_processed_at_received_at_idx" ON "BankWebhookEvent"("processed_at", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "BankWebhookEvent_connection_key_event_id_key" ON "BankWebhookEvent"("connection_key", "event_id");

-- AddForeignKey
ALTER TABLE "BankEmployeeAccount" ADD CONSTRAINT "BankEmployeeAccount_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPayrollRun" ADD CONSTRAINT "BankPayrollRun_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "BankPayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "Expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_reversal_expense_id_fkey" FOREIGN KEY ("reversal_expense_id") REFERENCES "Expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "BankPayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_amount_positive" CHECK (amount_cents > 0);

COMMIT;
