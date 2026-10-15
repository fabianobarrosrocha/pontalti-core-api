import { Order, OrderRegister } from "@pontalti/types/order.types";
import { CommonRequest } from "@pontalti/types/common.types";
import { assertOrderMutation, customerFinanceLock } from "@pontalti/modules/v1/customer-finance/legacy";
import prisma from "@pontalti/lib/prisma";
import { OrderItemRegister, ProductIdAndQuantity } from "@pontalti/types/order-item.types";

export const defaultSelectedFieldForOrders = {
  id: true,
  final_price: true,
  discount: true,
  date: true,
  status: true,
  created_at: true,
  updated_at: true,
  customer: {
    select: {
      id: true,
      status: true,
      address_id: true,
      credit_limit: true,
      debts: true,
      name: true,
      phone: true,
      cel_number: true,
      email: true,
      store_name: true,
      deliver: true,
      pontalti: true,
      secondary_line: true,
      cpf: true,
      cnpj: true,
      created_at: true,
      updated_at: true,
      address: {
        select: {
          id: true,
          zip_code: true,
          neighborhood: true,
          public_place: true,
          city: true,
          state: true,
          complement: true,
          address_number: true
        }
      }
    }
  },
  customer_id: true,
  financePurchase: { select: { id: true, status: true, environment: true, amount_cents: true, cash_applied_cents: true, projected_balance_cents: true, external_order_id: true, order_snapshot: true } },
  products: {
    select: {
      product_id: true,
      quantity: true,
      unit_price: true,
      registered_price: true,
      product: {
        select: {
          id: true,
          type: true,
          sku: true,
          status: true,
          inner_color: { select: { id: true, name: true, short_code: true } },
          outer_color: { select: { id: true, name: true, short_code: true } },
          foam: { select: { id: true, name: true, short_code: true } },
          mold: { select: { id: true, name: true, short_code: true } }
        }
      }
    }
  }
};

// GET /orders/:id — inclui também o rastreio completo (pagamentos, produção,
// entregas e nota fiscal) para a tela de detalhes do pedido.
const detailedSelectedFieldForOrder = {
  ...defaultSelectedFieldForOrders,
  payments: {
    select: { id: true, amount_paid: true, remaining: true, payment_method: true, date: true }
  },
  deliveries: {
    select: { id: true, status: true, delivery_date: true, created_at: true }
  },
  productionControl: {
    select: {
      id: true,
      status: true,
      material_disponibility: true,
      estimated_start_date: true,
      estimated_end_date: true,
      actual_start_date: true,
      actual_end_date: true,
      production_priority: true,
      observations: true
    }
  },
  invoice: {
    select: { id: true, number: true, status: true, type: true, issue_date: true, recipient: true, note: true }
  }
};

const createOrder = async (orderDetails: OrderRegister, products: ProductIdAndQuantity[]) => {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const registeredOrder = await transaction.orders.create({
        data: {
          final_price: orderDetails.final_price,
          discount: orderDetails.discount ?? 0,
          date: new Date(orderDetails.date),
          status: (orderDetails as { status?: number }).status ?? 1,
          customer_id: orderDetails.customer_id
        }
      });

      const productEntries = await Promise.all(
        products.map(async product => {
          return transaction.orderItems.create({
            data: {
              order_id: registeredOrder.id,
              product_id: product.id,
              quantity: product.quantity,
              unit_price: product.unit_price,
              registered_price: product.registered_price ?? null
            }
          });
        })
      );

      return {
        order: registeredOrder,
        products: productEntries
      };
    });

    return result;
  } catch (error) {
    console.error("Failed to create order and order items:", error);
    throw error;
  }
};

const getOrder = async (id: number) => {
  return await prisma.orders.findUnique({ where: { id }, select: detailedSelectedFieldForOrder });
};

const getOrders = async (filters: CommonRequest<Order>) => {
  // page/perPage chegam como string via querystring — coage antes de usar.
  const page = Number(filters.page) || undefined;
  const perPage = Number(filters.perPage) || undefined;
  const skip = page && perPage && page !== 1 ? (page - 1) * perPage : undefined;
  return await prisma.orders.findMany({
    take: perPage,
    skip: skip,
    orderBy: { id: "desc" },
    select: defaultSelectedFieldForOrders
  });
};

const updatePartialOrder = async (orderId: number, data: any): Promise<any> => {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      await customerFinanceLock(transaction);
      await assertOrderMutation(transaction, orderId, data);
      let updatedOrder;
      let updatedItems = [];

      if (data.order) {
        const orderData = { ...data.order };
        if (orderData.date) orderData.date = new Date(orderData.date);
        if (orderData.customer_id != null) orderData.customer_id = Number(orderData.customer_id);
        if (orderData.status != null) orderData.status = Number(orderData.status);
        updatedOrder = await transaction.orders.update({
          where: { id: orderId },
          data: orderData,
          select: defaultSelectedFieldForOrders
        });
      }

      // Substitui a lista de itens pela enviada (permite adicionar, remover e
      // alterar preço/quantidade). Só roda quando o body traz `items`.
      if (Array.isArray(data.items)) {
        const validItems = data.items.filter((item: any) => Number(item?.product_id) > 0);
        await transaction.orderItems.deleteMany({ where: { order_id: orderId } });
        updatedItems = await Promise.all(
          validItems.map((item: any) =>
            transaction.orderItems.create({
              data: {
                order_id: orderId,
                product_id: Number(item.product_id),
                quantity: Number(item.quantity) || 0,
                unit_price: Number(item.unit_price) || 0,
                registered_price: item.registered_price != null ? Number(item.registered_price) : null
              }
            })
          )
        );
      }

      return {
        order: updatedOrder,
        orderItems: updatedItems
      };
    });

    return result;
  } catch (error) {
    console.error("Failed to update order and/or order items:", error);
    throw error;
  }
};

const deleteOrder = async (id: number) => {
  return prisma.$transaction(async tx => {
    await customerFinanceLock(tx);
    await assertOrderMutation(tx, id);
    return tx.orders.delete({ where: { id }, select: defaultSelectedFieldForOrders });
  });
};

export default {
  createOrder,
  getOrder,
  getOrders,
  updatePartialOrder,
  deleteOrder
};
