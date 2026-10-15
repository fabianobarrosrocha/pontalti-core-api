import { Payment, PaymentRegister, PaymentRequest } from "@pontalti/types/payment.types";
import { CommonRequest } from "@pontalti/types/common.types";
import repository from "@pontalti/repository/payment";
import { defaultSelectedFieldForOrders } from "@pontalti/repository/order";
import prisma from "@pontalti/lib/prisma";
import createError from "http-errors";
import {
  assertLegacyPaymentMutable,
  customerFinanceLock,
  recordLegacyReceipt
} from "@pontalti/modules/v1/customer-finance/legacy";

const selected = { order: { select: defaultSelectedFieldForOrders } };
function amount(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-6
  ) {
    throw createError(400, "Informe um valor positivo em reais, com até duas casas decimais.");
  }
  return value;
}
const createPayment = async (data: PaymentRequest) =>
  prisma.$transaction(async (tx) => {
    await customerFinanceLock(tx);
    const paid = amount(data.amount_paid);
    const order = await tx.orders.findUnique({ where: { id: data.order_id }, include: { payments: true } });
    if (!order) throw createError(404, "Pedido não encontrado.");
    const remaining =
      Math.round((order.final_price - order.payments.reduce((sum, item) => sum + item.amount_paid, 0) - paid) * 100) /
      100;
    if (remaining < 0) throw createError(409, "O valor excede o restante deste pedido.");
    const payment = await tx.payments.create({
      data: {
        order_id: data.order_id,
        amount_paid: paid,
        remaining,
        payment_method: data.payment_method,
        date: new Date(data.date)
      },
      include: selected
    });
    await recordLegacyReceipt(tx, payment);
    return payment as unknown as Payment;
  });
const getAllPayments = async (filters: CommonRequest) => (await repository.getPayments(filters)) as Payment[];
const getPaymentById = async (id: number) => (await repository.getPayment(id)) as Payment;
const updatePartialPayment = async (id: number, data: any) =>
  prisma.$transaction(async (tx) => {
    await customerFinanceLock(tx);
    const existing = await assertLegacyPaymentMutable(tx, id);
    if (data.order_id !== undefined && data.order_id !== existing.order_id)
      throw createError(409, "Não é possível transferir um recebimento para outro pedido.");
    const paid = data.amount_paid === undefined ? existing.amount_paid : amount(data.amount_paid);
    const order = await tx.orders.findUnique({ where: { id: existing.order_id } });
    const others = await tx.payments.aggregate({
      where: { order_id: existing.order_id, id: { not: id } },
      _sum: { amount_paid: true }
    });
    const remaining = Math.round((order.final_price - (others._sum.amount_paid ?? 0) - paid) * 100) / 100;
    if (remaining < 0) throw createError(409, "O valor excede o restante deste pedido.");
    // The edited payment is deliberately excluded, fixing the former double count.
    return tx.payments.update({
      where: { id },
      data: {
        amount_paid: paid,
        remaining,
        ...(data.payment_method !== undefined ? { payment_method: String(data.payment_method) } : {}),
        ...(data.date !== undefined ? { date: new Date(data.date) } : {})
      },
      include: selected
    }) as unknown as Payment;
  });
const deletePayment = async (id: number) =>
  prisma.$transaction(async (tx) => {
    await customerFinanceLock(tx);
    await assertLegacyPaymentMutable(tx, id);
    return tx.payments.delete({ where: { id }, include: selected }) as unknown as Payment;
  });
export default { createPayment, getPaymentById, getAllPayments, updatePartialPayment, deletePayment };
