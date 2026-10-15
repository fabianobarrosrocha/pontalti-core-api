-- Additive supplier payments and reimbursements. Apply once after backing up.
BEGIN;
-- CreateEnum
CREATE TYPE "BankPaymentPurpose" AS ENUM ('SUPPLIER', 'REIMBURSEMENT');

-- CreateEnum
CREATE TYPE "BankPayableStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "BankNotification" ADD COLUMN     "payment_id" UUID,
ALTER COLUMN "transfer_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BankBeneficiary" (
    "id" UUID NOT NULL,
    "connection_key" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "document" VARCHAR(14) NOT NULL,
    "document_type" VARCHAR(4) NOT NULL,
    "bank_code" VARCHAR(3) NOT NULL,
    "branch_number" VARCHAR(4) NOT NULL,
    "account_number" VARCHAR(13) NOT NULL,
    "account_type" VARCHAR(10) NOT NULL,
    "employee_id" INTEGER,
    "vendor_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankBeneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankPayable" (
    "id" UUID NOT NULL,
    "connection_key" TEXT NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "purpose" "BankPaymentPurpose" NOT NULL,
    "beneficiary_id" UUID NOT NULL,
    "expense_id" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "status" "BankPayableStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "due_date" DATE NOT NULL,
    "justification" VARCHAR(1000) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankPayable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankPayment" (
    "id" UUID NOT NULL,
    "connection_key" TEXT NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "purpose" "BankPaymentPurpose" NOT NULL,
    "beneficiary_id" UUID NOT NULL,
    "beneficiary_name" TEXT NOT NULL,
    "destination" JSONB NOT NULL,
    "account_version" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "payment_date" DATE NOT NULL,
    "request_hash" TEXT NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "status" "BankTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "remote_id" TEXT,
    "remote_status" TEXT,
    "last_error" TEXT,
    "lease_until" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankPaymentAllocation" (
    "payment_id" UUID NOT NULL,
    "payable_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,

    CONSTRAINT "BankPaymentAllocation_pkey" PRIMARY KEY ("payment_id","payable_id")
);

-- CreateTable
CREATE TABLE "BankPayableReceipt" (
    "id" UUID NOT NULL,
    "payable_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "mime" VARCHAR(50) NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankPayableReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankBeneficiary_connection_key_document_key" ON "BankBeneficiary"("connection_key", "document");

-- CreateIndex
CREATE UNIQUE INDEX "BankPayable_expense_id_key" ON "BankPayable"("expense_id");

-- CreateIndex
CREATE INDEX "BankPayable_connection_key_purpose_created_at_idx" ON "BankPayable"("connection_key", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "BankPayment_idempotency_key_key" ON "BankPayment"("idempotency_key");

-- CreateIndex
CREATE INDEX "BankPayment_connection_key_status_updated_at_idx" ON "BankPayment"("connection_key", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "BankPayment_connection_key_remote_id_key" ON "BankPayment"("connection_key", "remote_id");

-- CreateIndex
CREATE INDEX "BankPaymentAllocation_payable_id_idx" ON "BankPaymentAllocation"("payable_id");

-- CreateIndex
CREATE INDEX "BankPayableReceipt_payable_id_idx" ON "BankPayableReceipt"("payable_id");

-- CreateIndex
CREATE UNIQUE INDEX "BankNotification_connection_key_payment_id_status_key" ON "BankNotification"("connection_key", "payment_id", "status");

-- AddForeignKey
ALTER TABLE "BankNotification" ADD CONSTRAINT "BankNotification_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "BankPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankBeneficiary" ADD CONSTRAINT "BankBeneficiary_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankBeneficiary" ADD CONSTRAINT "BankBeneficiary_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "Vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPayable" ADD CONSTRAINT "BankPayable_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "BankBeneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPayable" ADD CONSTRAINT "BankPayable_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "Expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPayable" ADD CONSTRAINT "BankPayable_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPayment" ADD CONSTRAINT "BankPayment_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "BankBeneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPayment" ADD CONSTRAINT "BankPayment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPaymentAllocation" ADD CONSTRAINT "BankPaymentAllocation_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "BankPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPaymentAllocation" ADD CONSTRAINT "BankPaymentAllocation_payable_id_fkey" FOREIGN KEY ("payable_id") REFERENCES "BankPayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPayableReceipt" ADD CONSTRAINT "BankPayableReceipt_payable_id_fkey" FOREIGN KEY ("payable_id") REFERENCES "BankPayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPayableReceipt" ADD CONSTRAINT "BankPayableReceipt_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "BankNotification" ADD CONSTRAINT "BankNotification_single_origin" CHECK (num_nonnulls(transfer_id, payment_id) = 1);
ALTER TABLE "BankPayable" ADD CONSTRAINT "BankPayable_positive_total" CHECK (total_cents > 0);
ALTER TABLE "BankPayment" ADD CONSTRAINT "BankPayment_positive_amount" CHECK (amount_cents > 0);
ALTER TABLE "BankPaymentAllocation" ADD CONSTRAINT "BankPaymentAllocation_positive_amount" CHECK (amount_cents > 0);
ALTER TABLE "BankBeneficiary" ADD CONSTRAINT "BankBeneficiary_single_link" CHECK (num_nonnulls(employee_id, vendor_id) <= 1);
ALTER TABLE "BankPayableReceipt" ADD CONSTRAINT "BankPayableReceipt_size" CHECK (size > 0 AND size <= 2000000 AND octet_length(content) = size);

COMMIT;
