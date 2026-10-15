-- Additive notification history and per-user read state. Apply once.
BEGIN;

CREATE TABLE "BankNotification" (
    "id" UUID NOT NULL,
    "connection_key" TEXT NOT NULL,
    "transfer_id" UUID NOT NULL,
    "status" "BankTransferStatus" NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankNotificationRead" (
    "notification_id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankNotificationRead_pkey" PRIMARY KEY ("notification_id", "user_id")
);

CREATE UNIQUE INDEX "BankNotification_connection_key_transfer_id_status_key"
    ON "BankNotification"("connection_key", "transfer_id", "status");
CREATE INDEX "BankNotification_connection_key_confirmed_at_id_idx"
    ON "BankNotification"("connection_key", "confirmed_at", "id");
CREATE INDEX "BankNotificationRead_user_id_idx" ON "BankNotificationRead"("user_id");

ALTER TABLE "BankNotification" ADD CONSTRAINT "BankNotification_transfer_id_fkey"
    FOREIGN KEY ("transfer_id") REFERENCES "BankTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankNotificationRead" ADD CONSTRAINT "BankNotificationRead_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "BankNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankNotificationRead" ADD CONSTRAINT "BankNotificationRead_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
