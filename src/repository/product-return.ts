import { CommonRequest } from "@pontalti/types/common.types";
import prisma from "@pontalti/lib/prisma";
import { ProductReturnRegister, ProductReturn } from "@pontalti/types/product-return.types";
import { defaultSelectedFieldForOrders } from "./order";
import { ReturnedLabel, ReturnedLabelRegister } from "@pontalti/types/returned_label.types";

const defaultSelectedFieldForProductReturn = {
  id: true,
  return_reason: true,
  replacement_necessary: true,
  resold: true,
  storage_location: true,
  date: true,
  created_at: true,
  updated_at: true,
  order: {
    select: defaultSelectedFieldForOrders
  }
};

const createProductReturn = async (product_return: ProductReturnRegister, returned_labels: ReturnedLabelRegister[]) => {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const registeredProductReturns = await prisma.productReturns.create({
        data: {
          date: new Date(product_return.date),
          replacement_necessary: product_return.replacement_necessary,
          resold: product_return.resold,
          storage_location: product_return.storage_location,
          return_reason: product_return.return_reason,
          order_id: product_return.order_id
        },
        select: defaultSelectedFieldForProductReturn
      });
      const labelsEntries = await Promise.all(
        returned_labels.map(async (returned_label) => {
          return transaction.returnedLabels.create({
            data: {
              ticket_code: returned_label.ticket_code,
              opened: returned_label.opened,
              quantity: returned_label.quantity,
              product_return_id: registeredProductReturns.id
            }
          });
        })
      );
      return {
        productsReturns: registeredProductReturns,
        labels: labelsEntries
      };
    });

    return result;
  } catch (error) {
    console.error("Failed to create order and order items:", error);
    throw error;
  }
};

const getProductReturn = async (id: number) => {
  return await prisma.productReturns.findUnique({ where: { id }, select: defaultSelectedFieldForProductReturn });
};

const getProductReturns = async (filters: CommonRequest<ProductReturn>) => {
  const { page, perPage } = filters;
  const skip = page !== 1 && page != undefined ? (page - 1) * perPage : undefined;
  return await prisma.productReturns.findMany({
    take: perPage,
    skip: skip,
    select: defaultSelectedFieldForProductReturn
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updatePartialProductReturn = async (id: number, data: any): Promise<ProductReturn> => {
  const existingProductReturn = await prisma.productReturns.findUnique({
    where: { id }
  });

  if (!existingProductReturn) {
    throw new Error("ProductReturn not found");
  }

  const updatedProductReturn = await prisma.productReturns.update({
    where: { id },
    data: {
      ...existingProductReturn,
      ...data
    },
    select: defaultSelectedFieldForProductReturn
  });

  return updatedProductReturn;
};

const deleteProductReturn = async (id: number) => {
  return await prisma.productReturns.delete({ where: { id }, select: defaultSelectedFieldForProductReturn });
};

export default {
  createProductReturn,
  getProductReturn,
  getProductReturns,
  updatePartialProductReturn,
  deleteProductReturn
};
