import { Order, OrderRegister } from "@pontalti/types/order.types";
import { CommonRequest } from "@pontalti/types/common.types";
import prisma from "@pontalti/lib/prisma";
import { OrderItem, OrderItemRegister } from "@pontalti/types/order-item.types";
import { defaultSelectedFieldForOrders } from "@pontalti/repository/order"

export const defaultSelectedFieldForOrdersItems = {
  quantity: true,
  order: { select: defaultSelectedFieldForOrders },
  product: {
    select: {
      id: true,
      type: true,
      sku: true,
      status: true,
      inner_color_id: true,
      foam_id: true,
      outer_color_id: true,
      mold_id: true,
      inner_color: true,
      outer_color: true,
      foam: true,
      mold: true,
      created_at: true,
      updated_at: true
    }
  },
  created_at: true,
  updated_at: true,
};

const createOrderItem = async (data: OrderItemRegister): Promise<OrderItem> => {
  return await prisma.orderItems.create({ data: {
    quantity: data.quantity,
    product_id: data.product_id,
    order_id: data.order_id
  }, select: defaultSelectedFieldForOrdersItems });
};

// const getOrder = async (id: number) => {
//   return await prisma.orderItems.findUnique({ where: { id }, select: defaultSelectedFieldForOrdersItems });
// };

// const getOrders = async (filters: CommonRequest<Order>) => {
//   const { page, perPage } = filters;
//   const skip = page !== 1 && page != undefined ? (page - 1) * perPage : undefined;
//   return await prisma.orderItems.findMany({
//     take: perPage,
//     skip: skip,
//     select: defaultSelectedFieldForOrdersItems
//   });
// };

// // eslint-disable-next-line @typescript-eslint/no-explicit-any
// const updatePartialOrder = async (id: number, data: any): Promise<Order> => {
//   const existingOrder = await prisma.orderItems.findUnique({
//     where: { id }
//   });

//   if (!existingOrder) {
//     throw new Error("Order not found");
//   }

//   const updatedOrder = await prisma.orderItems.update({
//     where: { id },
//     data: {
//       ...existingOrder,
//       ...data
//     },
//     select: defaultSelectedFieldForOrdersItems
//   });

//   return updatedOrder;
// };

// const deleteOrder = async (id: number) => {
//   return await prisma.orderItems.delete({ where: { id }, select: defaultSelectedFieldForOrdersItems });
// };

export default {
  createOrderItem,
  // getOrder,
  // getOrders,
  // updatePartialOrder,
  // deleteOrder
};
