import prisma from "@pontalti/lib/prisma";

export type ProductStats = {
  product_id: number;
  quantity_ordered: number;
  quantity_returned: number;
  quantity_net: number;
  revenue_gross: number;
  revenue_returned: number;
  revenue_net: number;
  paid_orders_count: number;
};

/**
 * Calcula estatísticas all-time para um produto:
 * - Quantidade pedida: SUM(OrderItems.quantity) em pedidos pagos
 * - Receita bruta: SUM(quantity * unit_price)
 * - Devoluções: aproximação proporcional usando ReturnedLabels.quantity
 *   (modelo atual não liga ReturnedLabels diretamente a OrderItems; assumimos
 *   distribuição proporcional ao share do produto no pedido)
 * - Pedido pago = SUM(Payments.amount_paid) >= Orders.final_price
 */
const getProductStats = async (productId: number): Promise<ProductStats> => {
  // 1) Todos os OrderItems desse produto, com order + payments + returns
  const items = await prisma.orderItems.findMany({
    where: { product_id: productId },
    include: {
      order: {
        include: {
          payments: { select: { amount_paid: true } },
          productReturns: { include: { returnedLabels: { select: { quantity: true } } } },
          products: { select: { quantity: true } }
        }
      }
    }
  });

  let quantityOrdered = 0;
  let revenueGross = 0;
  let quantityReturned = 0;
  let revenueReturned = 0;
  let paidOrdersCount = 0;

  for (const item of items) {
    const order = item.order;
    if (!order) continue;
    const paid = order.payments.reduce((s, p) => s + (p.amount_paid ?? 0), 0);
    const isPaid = paid + 1e-6 >= (order.final_price ?? 0);
    if (!isPaid) continue;

    paidOrdersCount += 1;
    quantityOrdered += item.quantity;
    revenueGross += item.quantity * item.unit_price;

    // Devoluções: distribuir proporcionalmente entre os itens do pedido
    const totalOrderQty = order.products.reduce((s, oi) => s + (oi.quantity ?? 0), 0) || 1;
    const itemShare = item.quantity / totalOrderQty;

    const returnedQtyInOrder = order.productReturns.reduce((s, r) => {
      return s + r.returnedLabels.reduce((acc, lbl) => acc + (lbl.quantity ?? 0), 0);
    }, 0);

    const proportionalQtyReturned = returnedQtyInOrder * itemShare;
    quantityReturned += proportionalQtyReturned;
    revenueReturned += proportionalQtyReturned * item.unit_price;
  }

  return {
    product_id: productId,
    quantity_ordered: Math.round(quantityOrdered),
    quantity_returned: Math.round(quantityReturned * 100) / 100,
    quantity_net: Math.round((quantityOrdered - quantityReturned) * 100) / 100,
    revenue_gross: Math.round(revenueGross * 100) / 100,
    revenue_returned: Math.round(revenueReturned * 100) / 100,
    revenue_net: Math.round((revenueGross - revenueReturned) * 100) / 100,
    paid_orders_count: paidOrdersCount
  };
};

export default { getProductStats };
