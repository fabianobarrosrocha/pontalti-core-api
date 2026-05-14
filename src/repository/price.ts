import prisma, { dbErrorHandle } from "@pontalti/lib/prisma";
import { CreatePriceData, UpdatePriceData, Price } from "@pontalti/types/price.types";

const defaultInclude = {
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
      updated_at: true
    }
  }
};

const createPrice = async (data: CreatePriceData): Promise<Price> => {
  try {
    return await prisma.prices.create({
      data: {
        ...data,
        created_at: new Date(),
        last_update: new Date()
      },
      include: defaultInclude
    });
  } catch (e) {
    dbErrorHandle(e);
  }
};

const getPriceById = async (id: number): Promise<Price> => {
  try {
    return await prisma.prices.findUnique({
      where: { id },
      include: defaultInclude
    });
  } catch (e) {
    dbErrorHandle(e);
  }
};

const getPriceByProductAndCustomer = async (product_id: number, customer_id?: number): Promise<Price | null> => {
  try {
    // Tenta primeiro o preço específico do cliente, se fornecido
    if (customer_id) {
      const specific = await prisma.prices.findFirst({
        where: { product_id, customer_id },
        include: defaultInclude
      });
      if (specific) return specific;
    }
    // Fallback: preço padrão (customer_id null)
    return await prisma.prices.findFirst({
      where: { product_id, customer_id: null },
      include: defaultInclude
    });
  } catch (e) {
    dbErrorHandle(e);
  }
};

const getAllPrices = async (): Promise<Price[]> => {
  try {
    return await prisma.prices.findMany({
      include: defaultInclude
    });
  } catch (e) {
    dbErrorHandle(e);
  }
};

const updatePrice = async (id: number, data: UpdatePriceData): Promise<Price> => {
  try {
    return await prisma.prices.update({
      where: { id },
      data: {
        ...data,
        last_update: new Date()
      },
      include: defaultInclude
    });
  } catch (e) {
    dbErrorHandle(e);
  }
};

const deletePrice = async (id: number): Promise<Price> => {
  try {
    return await prisma.prices.delete({
      where: { id },
      include: defaultInclude
    });
  } catch (e) {
    dbErrorHandle(e);
  }
};

export default {
  createPrice,
  getPriceById,
  getPriceByProductAndCustomer,
  getAllPrices,
  updatePrice,
  deletePrice
}; 