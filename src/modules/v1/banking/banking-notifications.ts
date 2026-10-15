import { BankTransferStatus, Prisma, PrismaClient } from "@prisma/client";
import createError from "http-errors";
import { validateUuid } from "./banking-schema";

const notificationStatuses: BankTransferStatus[] = [
  "INITIATED", "SCHEDULED", "COMPLETED", "REJECTED", "CANCELLED", "REFUNDED", "UNKNOWN", "FAILED"
];
const attentionStatuses: BankTransferStatus[] = ["REJECTED", "CANCELLED", "REFUNDED", "UNKNOWN", "FAILED"];

// Called only in the transaction that validates and applies an authenticated bank response.
export async function recordBankNotification(tx: Prisma.TransactionClient, transfer: {
  id: string; connection_key: string; status: BankTransferStatus;
  completed_at: Date | null; refunded_at: Date | null; submitted_at: Date | null;
}, now: Date) {
  if (!notificationStatuses.includes(transfer.status)) return;
  const confirmed_at = transfer.status === "COMPLETED" ? transfer.completed_at ?? now
    : transfer.status === "REFUNDED" ? transfer.refunded_at ?? now
    : transfer.status === "INITIATED" ? transfer.submitted_at ?? now : now;
  await tx.bankNotification.upsert({
    where: { connection_key_transfer_id_status: {
      connection_key: transfer.connection_key, transfer_id: transfer.id, status: transfer.status
    } },
    create: { connection_key: transfer.connection_key, transfer_id: transfer.id,
      status: transfer.status, confirmed_at, created_at: now },
    update: {}
  });
}

export async function recordPaymentNotification(tx: Prisma.TransactionClient, payment: {
  id: string; connection_key: string; status: BankTransferStatus;
  completed_at: Date | null; refunded_at: Date | null; submitted_at: Date | null;
}, now: Date) {
  if (!notificationStatuses.includes(payment.status)) return;
  const confirmed_at = payment.status === "COMPLETED" ? payment.completed_at ?? now
    : payment.status === "REFUNDED" ? payment.refunded_at ?? now : payment.submitted_at ?? now;
  await tx.bankNotification.upsert({
    where: { connection_key_payment_id_status: { connection_key: payment.connection_key, payment_id: payment.id, status: payment.status } },
    create: { connection_key: payment.connection_key, payment_id: payment.id, status: payment.status, confirmed_at, created_at: now }, update: {}
  });
}

export class BankingNotifications {
  constructor(readonly db: PrismaClient, readonly connectionKey: string, readonly now = () => new Date()) {}

  async summary(userId: number) {
    const scope = { connection_key: this.connectionKey };
    const [unread_count, completed_count, attention_count] = await this.db.$transaction([
      this.db.bankNotification.count({ where: { ...scope, reads: { none: { user_id: userId } } } }),
      this.db.bankNotification.count({ where: { ...scope, status: "COMPLETED" } }),
      this.db.bankNotification.count({ where: { ...scope, status: { in: attentionStatuses } } })
    ]);
    return { unread_count, completed_count, attention_count };
  }

  async list(userId: number, query: { page?: unknown; unread?: unknown; status?: unknown }) {
    const page = Number(query.page ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 1000 ||
      (query.unread !== undefined && query.unread !== "true" && query.unread !== "false") ||
      (query.status !== undefined && !notificationStatuses.includes(query.status as BankTransferStatus))) {
      throw createError(400, "Confira os filtros das notificações.");
    }
    const as_of = this.now();
    const page_size = 25;
    const where: Prisma.BankNotificationWhereInput = {
      connection_key: this.connectionKey, created_at: { lte: as_of },
      ...(query.unread === "true" ? { reads: { none: { user_id: userId } } } : {}),
      ...(query.status ? { status: query.status as BankTransferStatus } : {})
    };
    const [total, rows] = await this.db.$transaction([
      this.db.bankNotification.count({ where }),
      this.db.bankNotification.findMany({ where, skip: (page - 1) * page_size, take: page_size,
        orderBy: [{ confirmed_at: "desc" }, { id: "desc" }],
        select: { id: true, status: true, confirmed_at: true, reads: {
          where: { user_id: userId }, select: { read_at: true }
        }, payment: { select: { id: true, purpose: true, beneficiary_name: true, amount_cents: true, environment: true } },
        transfer: { select: { id: true, run_id: true, beneficiary_name: true, amount_cents: true,
          run: { select: { competence: true, kind: true, environment: true } } } } }
      })
    ]);
    return { items: rows.map(({ reads, transfer, payment, ...row }) => payment ? ({ ...row,
      read_at: reads[0]?.read_at ?? null, payment_id: payment.id, transfer_id: null, run_id: null, kind: null, competence: null,
      beneficiary_name: payment.beneficiary_name, amount_cents: payment.amount_cents,
      purpose: payment.purpose, environment: payment.environment
    }) : ({ ...row, read_at: reads[0]?.read_at ?? null, payment_id: null, purpose: null, transfer_id: transfer!.id, run_id: transfer!.run_id,
      beneficiary_name: transfer!.beneficiary_name, amount_cents: transfer!.amount_cents, ...transfer!.run
    })), page, page_size, total, as_of, ...await this.summary(userId) };
  }

  async markRead(id: string, userId: number) {
    validateUuid(id);
    const notification = await this.db.bankNotification.findFirst({ where: { id, connection_key: this.connectionKey } });
    if (!notification) throw createError(404, "Notificação não encontrada.");
    await this.db.bankNotificationRead.createMany({
      data: [{ notification_id: id, user_id: userId, read_at: this.now() }], skipDuplicates: true
    });
    return { read: true };
  }

  async markAllRead(before: unknown, userId: number) {
    if (typeof before !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(before) || !Number.isFinite(Date.parse(before)) ||
      Date.parse(before) > this.now().getTime()) throw createError(400, "Atualize as notificações antes de marcar como lidas.");
    // A cutoff prevents marking notices that arrived after the user loaded the page.
    const count = await this.db.$executeRaw`
      INSERT INTO "BankNotificationRead" ("notification_id", "user_id", "read_at")
      SELECT n.id, ${userId}, ${this.now()} FROM "BankNotification" n
      WHERE n.connection_key = ${this.connectionKey} AND n.created_at <= ${new Date(before)}
      ON CONFLICT ("notification_id", "user_id") DO NOTHING
    `;
    return { marked_count: count };
  }
}
