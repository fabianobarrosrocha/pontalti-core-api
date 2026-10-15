import createError from "http-errors";
import { cpf, cnpj } from "cpf-cnpj-validator";
import { createHash } from "node:crypto";
import { BankEnvironment, Prisma } from "@prisma/client";

export const money = (value: unknown, positive = true): number => {
  if (!Number.isSafeInteger(value) || Number(value) > 1_000_000_000 || Number(value) < (positive ? 1 : 0)) {
    throw createError(400, "Informe o valor em centavos inteiros válidos.");
  }
  return Number(value);
};
export const integer = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw createError(400, "Identificador ou versão inválido.");
  return Number(value);
};
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw createError(400, "Referência inválida.");
  }
  return value;
}
export function environment(value: unknown): BankEnvironment {
  if (value !== "STAGE" && value !== "PRODUCTION") throw createError(400, "Selecione o ambiente STAGE ou PRODUCTION.");
  return value;
}
export function text(value: unknown, max = 200, required = true): string {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw createError(400, "Confira o texto informado.");
  }
  return value.trim();
}
export function document(value: unknown) {
  if (typeof value !== "string" || value.length > 25) throw createError(400, "CPF/CNPJ inválido.");
  const normalized = value.replace(/\D/g, "");
  if (!cpf.isValid(normalized) && !cnpj.isValid(normalized)) throw createError(400, "CPF/CNPJ inválido.");
  return normalized;
}
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type PurchaseSnapshot = {
  items: Array<{ name: string; product_id?: number; quantity: number; unit_price_cents: number }>;
  shipping_cents: number;
  discount_cents: number;
  order_number?: string;
  notes?: string | null;
  delivery?: string;
  address?: Record<string, string | number | null> | null;
};
export function snapshot(value: any, amount: number): PurchaseSnapshot {
  if (!value || !Array.isArray(value.items) || !value.items.length || value.items.length > 100) {
    throw createError(400, "Inclua os produtos do pedido.");
  }
  const items = value.items.map((item: any) => ({
    name: text(item.name, 200),
    quantity: integer(item.quantity),
    unit_price_cents: money(item.unit_price_cents, false),
    ...(item.product_id === undefined || item.product_id === null ? {} : { product_id: integer(item.product_id) })
  }));
  const shipping_cents = money(value.shipping_cents ?? 0, false);
  const discount_cents = money(value.discount_cents ?? 0, false);
  const sum = items.reduce((acc, item) => acc + item.quantity * item.unit_price_cents, 0);
  if (!Number.isSafeInteger(sum) || sum + shipping_cents - discount_cents !== amount) {
    throw createError(400, "O total dos produtos, frete e desconto difere do pedido.");
  }
  let address: Record<string, string | number | null> | null | undefined;
  if (value.address === null) address = null;
  else if (value.address !== undefined) {
    if (!value.address || typeof value.address !== "object" || Array.isArray(value.address))
      throw createError(400, "Endereço de entrega inválido.");
    address = {};
    for (const key of ["zip_code", "neighborhood", "public_place", "city", "state", "address_number", "complement"]) {
      const field = value.address[key];
      if (field === undefined || field === null) address[key] = null;
      else if (key === "address_number" && typeof field === "number" && Number.isSafeInteger(field) && field >= 0)
        address[key] = field;
      else address[key] = text(field, key === "state" ? 2 : 200, false);
    }
  }
  return {
    items,
    shipping_cents,
    discount_cents,
    ...(value.order_number ? { order_number: text(value.order_number, 80) } : {}),
    ...(value.notes !== undefined ? { notes: value.notes === null ? null : text(value.notes, 2000, false) } : {}),
    ...(value.delivery !== undefined && value.delivery !== null ? { delivery: text(value.delivery, 300, false) } : {}),
    ...(address !== undefined ? { address } : {})
  };
}
export async function lock(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('pontalti-customer-finance'))`;
}
