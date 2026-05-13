import { CommonRequest } from "@pontalti/types/common.types";
import prisma from "@pontalti/lib/prisma";
import { MaterialOrderRegister, MaterialOrder } from "@pontalti/types/material-order.types";

const defaultSelectedFieldForMaterialOrder = {
  id: true,
  date: true,
  amount: true,
  unit: true,
  storage_location: true,
  received_by: true,
  created_at: true,
  updated_at: true,
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
  vendor: {
    select: {
      id: true,
      name: true,
      store_name: true,
      cnpj: true,
      status: true,
      phone: true,
      cel_number: true,
      deliver: true,
      volume_purchases: true,
      purchases: true,
      invoicing: true,
      address: true,
      created_at: true,
      updated_at: true,
    }
  },
};

const createMaterialOrder = async (data: MaterialOrderRegister): Promise<MaterialOrder> => {
  console.log(data)
  return await prisma.materialOrders.create({ data: {
    amount: data.amount,
    date: new Date(data.date),
    received_by: data.received_by,
    storage_location: data.storage_location,
    unit: data.unit,
    product_id: data.product_id,
    vendor_id: data.vendor_id,    
  }, select: defaultSelectedFieldForMaterialOrder });
};

const getMaterialOrder = async (id: number) => {
  return await prisma.materialOrders.findUnique({ where: { id }, select: defaultSelectedFieldForMaterialOrder });
};

const getMaterialOrders = async (filters: CommonRequest<MaterialOrder>) => {
  const { page, perPage } = filters;
  const skip = page !== 1 && page != undefined ? (page - 1) * perPage : undefined;
  return await prisma.materialOrders.findMany({
    take: perPage,
    skip: skip,
    select: defaultSelectedFieldForMaterialOrder
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updatePartialMaterialOrder = async (id: number, data: any): Promise<MaterialOrder> => {
  const existingMaterialOrder = await prisma.materialOrders.findUnique({
    where: { id }
  });

  if (!existingMaterialOrder) {
    throw new Error("MaterialOrder not found");
  }

  const updatedMaterialOrder = await prisma.materialOrders.update({
    where: { id },
    data: {
      ...existingMaterialOrder,
      ...data
    },
    select: defaultSelectedFieldForMaterialOrder
  });

  return updatedMaterialOrder;
};

const deleteMaterialOrder = async (id: number) => {
  return await prisma.materialOrders.delete({ where: { id }, select: defaultSelectedFieldForMaterialOrder });
};

export default {
  createMaterialOrder,
  getMaterialOrder,
  getMaterialOrders,
  updatePartialMaterialOrder,
  deleteMaterialOrder
};
