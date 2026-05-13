import prisma from "@pontalti/lib/prisma";
import { CommonRequest } from "@pontalti/types/common.types";
import { Product, ProductRegister } from "@pontalti/types/product.types";

const defaultInclude = {
  inner_color: true,
  outer_color: true,
  foam: true,
  mold: true
} as const;

const createProduct = async (data: ProductRegister & { sku: string }): Promise<Product> => {
  return (await prisma.products.create({
    data,
    include: defaultInclude
  })) as unknown as Product;
};

const getProduct = async (id: number): Promise<Product | null> => {
  return (await prisma.products.findUnique({
    where: { id },
    include: defaultInclude
  })) as unknown as Product | null;
};

const getProducts = async (filters: CommonRequest<Product>): Promise<Product[]> => {
  const { page, perPage } = filters;
  const skip = page !== 1 && page != undefined ? (page - 1) * perPage : undefined;
  return (await prisma.products.findMany({
    take: perPage,
    skip,
    include: defaultInclude,
    orderBy: { id: "asc" }
  })) as unknown as Product[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updatePartialProduct = async (id: number, data: any): Promise<Product> => {
  return (await prisma.products.update({
    where: { id },
    data,
    include: defaultInclude
  })) as unknown as Product;
};

const deleteProduct = async (id: number): Promise<Product> => {
  return (await prisma.products.delete({
    where: { id },
    include: defaultInclude
  })) as unknown as Product;
};

const findExistingVariant = async (
  type: "bojo" | "dublado",
  inner_color_id: number,
  foam_id: number,
  outer_color_id: number,
  mold_id: number | null
): Promise<{ id: number } | null> => {
  return await prisma.products.findFirst({
    where: { type, inner_color_id, foam_id, outer_color_id, mold_id },
    select: { id: true }
  });
};

export default {
  createProduct,
  getProduct,
  getProducts,
  updatePartialProduct,
  deleteProduct,
  findExistingVariant
};
