import { Order, OrderRegister } from "@pontalti/types/order.types";
import { CommonRequest } from "@pontalti/types/common.types";
import prisma from "@pontalti/lib/prisma";
import { OrderItemRegister, ProductIdAndQuantity } from "@pontalti/types/order-item.types";

export const defaultSelectedFieldForOrders = {
  id: true,
  final_price: true,
  discount: true,
  date: true,
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
};

const createOrder = async (orderDetails: OrderRegister, products: ProductIdAndQuantity[]) => {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const registeredOrder = await transaction.orders.create({
        data: {
          final_price: orderDetails.final_price,
          discount: orderDetails.discount ?? 0,
          date: new Date(orderDetails.date),
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
  return await prisma.orders.findUnique({ where: { id }, select: defaultSelectedFieldForOrders });
};

const getOrders = async (filters: CommonRequest<Order>) => {
  const { page, perPage } = filters;
  const skip = page !== 1 && page != undefined ? (page - 1) * perPage : undefined;
  return await prisma.orders.findMany({
    take: perPage,
    skip: skip,
    select: defaultSelectedFieldForOrders
  });
};

const updatePartialOrder = async (orderId: number, data: any): Promise<any> => {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      let updatedOrder;
      let updatedItems = [];

      if (data.order) {
        updatedOrder = await transaction.orders.update({
          where: { id: orderId },
          data: data.order,
          select: defaultSelectedFieldForOrders
        });
      }

      if (data.items && data.items.length > 0) {
        updatedItems = await Promise.all(
          data.items.map(item => {
            if(item.product_id){
              return transaction.orderItems.updateMany({
                where: {
                  order_id: orderId,
                  product_id: item.product_id
                },
                data: {
                  quantity: item.quantity
                }
              });
            }
          })
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
  return await prisma.orders.delete({ where: { id }, select: defaultSelectedFieldForOrders });
};

export default {
  createOrder,
  getOrder,
  getOrders,
  updatePartialOrder,
  deleteOrder
};
