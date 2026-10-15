import createError from "http-errors";
import { BankTransferStatus } from "@prisma/client";

export const BANK_TIMEZONE = "America/Sao_Paulo";
export const MAX_AMOUNT_CENTS = 2147483647;
export const PAYROLL_KINDS = ["SALARY", "ADVANCE", "VACATION", "BONUS"] as const;
export const KIND_LABELS = { SALARY: "Salário", ADVANCE: "Adiantamento", VACATION: "Férias", BONUS: "Bônus" };

export type Destination = {
  bank_code: string;
  branch_number: string;
  account_number: string;
  account_number_digit?: string;
  account_type: string;
  holder: { name: string; document: { identity: string; type: "CPF" | "CNPJ" } };
};

export type TransferPayload = {
  destination: Destination;
  amount: number;
  code: string;
  description: string;
  category?: string;
  scheduled: string;
};

export type RemoteTransfer = Omit<TransferPayload, "destination" | "scheduled"> & {
  destination: Omit<Destination, "holder"> & {
    holder: { name: string; document: { identity: string; type?: "CPF" | "CNPJ" } };
  };
  scheduled?: string;
  id: string;
  status: string;
  created_at?: string;
};

export function dateInSaoPaulo(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BANK_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validDate(value: string): boolean {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Interpret the form's wall clock in the company's timezone, never the server/browser timezone.
export function saoPauloInstant(value: string): Date {
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !validDate(value.slice(0, 10))) {
    throw createError(400, "Data de envio inválida.");
  }
  const desired = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(desired)) throw createError(400, "Horário de envio inválido.");
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: BANK_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  let actual = desired;
  for (let i = 0; i < 3; i++) {
    const displayed = formatter.format(new Date(actual)).replace(" ", "T");
    const delta = desired - new Date(`${displayed}Z`).getTime();
    actual += delta;
    if (delta === 0) break;
  }
  const result = new Date(actual);
  if (formatter.format(result).replace(" ", "T").slice(0, 16) !== value) {
    throw createError(400, "Horário de envio inexistente no fuso de São Paulo.");
  }
  return result;
}

export function validateSchedule(paymentDate: string, submitAt: Date, now = new Date()) {
  if (!validDate(paymentDate) || paymentDate < dateInSaoPaulo(now)) {
    throw createError(400, "A data de pagamento deve ser hoje ou uma data futura.");
  }
  if (dateInSaoPaulo(submitAt) > paymentDate) {
    throw createError(400, "O envio deve ocorrer até a data de pagamento.");
  }
}

export function normalizeStatus(remote: string): BankTransferStatus {
  const statuses: Record<string, BankTransferStatus> = {
    INITIATED: "INITIATED", APPROVED: "SCHEDULED", SCHEDULED: "SCHEDULED",
    COMPLETED: "COMPLETED", REPROVED: "REJECTED", REJECTED: "REJECTED",
    CANCELED: "CANCELLED", CANCELLED: "CANCELLED", REFUNDED: "REFUNDED"
  };
  return statuses[remote.toUpperCase()] ?? "UNKNOWN";
}

export function nextStatus(current: BankTransferStatus, remote: BankTransferStatus): BankTransferStatus {
  if (current === "REFUNDED") return current;
  if (remote === "REFUNDED") return remote;
  if (current === "COMPLETED") return current;
  if (remote === "COMPLETED") return remote;
  if (["CANCELLED", "REJECTED"].includes(current)) return current;
  if (current === "SCHEDULED" && remote === "INITIATED") return current;
  return remote;
}

const numeric = (value: string) => value.replace(/^0+(?=\d)/, "");

export function matchesTransfer(expected: TransferPayload, remote: RemoteTransfer, remoteId?: string | null): boolean {
  const target = remote.destination;
  if (typeof remote.id !== "string" || typeof remote.status !== "string" ||
    !target?.holder?.document || ![target.account_number, target.branch_number, target.bank_code].every((v) => typeof v === "string" && /^\d+$/.test(v)) ||
    (target.account_number_digit !== undefined && (typeof target.account_number_digit !== "string" || !/^\d*$/.test(target.account_number_digit)))) return false;
  const remoteNumber = target.account_number + (target.account_number_digit ?? "");
  const identity = target.holder.document.identity;
  // Cora omits the optional document type in live responses. Infer it only from a full numeric document.
  const documentType = target.holder.document.type ?? (typeof identity === "string"
    ? /^\d{11}$/.test(identity) ? "CPF" : /^\d{14}$/.test(identity) ? "CNPJ" : undefined
    : undefined);
  return (!remoteId || remote.id === remoteId) && remote.code === expected.code &&
    remote.amount === expected.amount &&
    numeric(target.bank_code) === numeric(expected.destination.bank_code) &&
    numeric(target.branch_number) === numeric(expected.destination.branch_number) &&
    numeric(remoteNumber) === numeric(expected.destination.account_number) &&
    target.account_type === expected.destination.account_type &&
    documentType === expected.destination.holder.document.type &&
    target.holder.document.identity === expected.destination.holder.document.identity &&
    (!remote.scheduled || remote.scheduled === expected.scheduled);
}

export function maskDestination(destination: Destination) {
  return {
    bank_code: destination.bank_code,
    branch_number: destination.branch_number,
    account_number: `••••${destination.account_number.slice(-4)}`,
    holder_document: `***${destination.holder.document.identity.slice(-4)}`
  };
}
