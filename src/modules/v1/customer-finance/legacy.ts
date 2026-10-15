import { BankEnvironment, Prisma } from "@prisma/client";
import createError from "http-errors";
import prisma from "@pontalti/lib/prisma";
import { lock } from "./domain";

/** Customer fields are projections of the shared financial ledger after the first use. */
export async function assertCustomerMutation(tx: Prisma.TransactionClient, customerId: number, data: any) {
  const current = await tx.customers.findUnique({ where: { id: customerId } });
  if (!current) throw createError(404, "Cliente não encontrado.");
  const hasEntries = !!(await tx.customerFinanceEntry.findFirst({
    where: { customer_id: customerId, environment: "PRODUCTION" },
    select: { id: true }
  }));
  if (hasEntries && data.debts !== undefined && Number(data.debts) !== current.debts) {
    throw createError(
      409,
      "Os débitos deste cliente são calculados pelo Financeiro. Registre o recebimento ou a correção no fluxo financeiro para preservar o histórico."
    );
  }
  const hasLink = !!(await tx.customerFinanceLink.findFirst({
    where: { customer_id: customerId, status: "APPROVED" },
    select: { id: true }
  }));
  if (
    hasLink &&
    ((data.cpf !== undefined &&
      String(data.cpf ?? "").replace(/\D/g, "") !== String(current.cpf ?? "").replace(/\D/g, "")) ||
      (data.cnpj !== undefined &&
        String(data.cnpj ?? "").replace(/\D/g, "") !== String(current.cnpj ?? "").replace(/\D/g, "")))
  ) {
    throw createError(
      409,
      "Este documento identifica um vínculo financeiro. Solicite a revisão do vínculo antes de alterá-lo."
    );
  }
}
export async function assertOrderMutation(tx: Prisma.TransactionClient, orderId: number, data?: any) {
  const purchase = await tx.customerFinancePurchase.findUnique({ where: { core_order_id: orderId } });
  if (!purchase) return;
  if (
    !data ||
    data.items !== undefined ||
    data.order?.final_price !== undefined ||
    data.order?.customer_id !== undefined ||
    data.order?.discount !== undefined ||
    Number(data.order?.status) === 5
  ) {
    throw createError(
      409,
      "Este pedido possui pagamento com saldo e crédito aprovado. Valores, cliente, produtos e cancelamento exigem revisão financeira para preservar os recebimentos e débitos."
    );
  }
  if (purchase.status !== "APPROVED")
    throw createError(409, "A continuidade deste pedido depende da aprovação financeira.");
}

/** Real receipts on financed orders reduce the same debt and never create a second wallet. */
export async function recordLegacyReceipt(
  tx: Prisma.TransactionClient,
  payment: { id: number; order_id: number; amount_paid: number }
) {
  const purchase = await tx.customerFinancePurchase.findUnique({ where: { core_order_id: payment.order_id } });
  if (!purchase) {
    const order = await tx.orders.findUnique({ where: { id: payment.order_id }, select: { customer_id: true } });
    const managed =
      order &&
      (await tx.customerFinanceEntry.findFirst({
        where: { customer_id: order.customer_id, environment: "PRODUCTION" },
        select: { id: true }
      }));
    if (managed)
      throw createError(
        409,
        "Este pedido anterior não está conciliado com a conta financeira do cliente. Solicite à Pontalti a revisão da dívida histórica antes de registrar outro recebimento."
      );
    return;
  }
  const amount = Math.round(payment.amount_paid * 100);
  if (
    purchase.environment !== "PRODUCTION" ||
    purchase.status !== "APPROVED" ||
    amount <= 0 ||
    amount > purchase.amount_cents - purchase.cash_applied_cents
  ) {
    throw createError(409, "O recebimento não corresponde ao saldo devedor deste pedido.");
  }
  await tx.customerFinanceEntry.create({
    data: {
      customer_id: purchase.customer_id,
      environment: BankEnvironment.PRODUCTION,
      entry_key: `payment:${payment.id}`,
      payment_id: payment.id,
      purchase_id: purchase.id,
      kind: "RECEIPT",
      amount_cents: amount,
      description: "Recebimento registrado no fluxo de pagamentos existente"
    }
  });
  await tx.customerFinancePurchase.update({
    where: { id: purchase.id },
    data: { cash_applied_cents: { increment: amount }, version: { increment: 1 } }
  });
  await tx.customerFinanceRevision.upsert({
    where: { customer_id_environment: { customer_id: purchase.customer_id, environment: purchase.environment } },
    create: { customer_id: purchase.customer_id, environment: purchase.environment, revision: 1 },
    update: { revision: { increment: 1 } }
  });
  const aggregate = await tx.customerFinanceEntry.aggregate({
    where: { customer_id: purchase.customer_id, environment: purchase.environment },
    _sum: { amount_cents: true }
  });
  await tx.customers.update({
    where: { id: purchase.customer_id },
    data: { debts: Math.max(0, -(aggregate._sum.amount_cents ?? 0)) / 100, updated_at: new Date() }
  });
  await tx.financialAuditEvent.create({
    data: {
      action: "CUSTOMER_RECEIPT_RECORDED",
      resource_id: purchase.id,
      details: { payment_id: payment.id, amount_cents: amount }
    }
  });
}
export async function assertLegacyPaymentMutable(tx: Prisma.TransactionClient, paymentId: number) {
  const payment = await tx.payments.findUnique({
    where: { id: paymentId },
    include: { financeEntry: true, order: { select: { financePurchase: { select: { id: true } } } } }
  });
  if (!payment) throw createError(404, "Pagamento não encontrado.");
  if (payment.financeEntry || payment.order.financePurchase)
    throw createError(
      409,
      "Este recebimento está no histórico financeiro do cliente. Solicite uma correção auditada; a edição ou exclusão direta está bloqueada."
    );
  return payment;
}
export { lock as customerFinanceLock };
