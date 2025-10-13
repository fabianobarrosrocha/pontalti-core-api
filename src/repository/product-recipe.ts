import { ProductRecipe, ProductRecipeRegister, ProductRecipeRequest, UpdatePartialProductRecipe } from "@pontalti/types/product-recipe.types";
import prisma, { dbErrorHandle } from "@pontalti/lib/prisma";
import { PaginationResponse } from "@pontalti/types/common.types";

const defaultInclude = {
  product: true,
  material_order: {
    include: {
      product: true,
      vendor: true
    }
  }
};

const createProductRecipe = async (data: ProductRecipeRegister): Promise<any> => {
  try {
    return await prisma.productRecipe.create({
      data,
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getProductRecipe = async (id: number): Promise<any> => {
  try {
    return await prisma.productRecipe.findUnique({ 
      where: { id }, 
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getProductRecipes = async (filters: ProductRecipeRequest): Promise<PaginationResponse<any>> => {
  try {
    const { page = 1, perPage = 10, ...where } = filters;
    const skip = page !== 1 ? (page - 1) * perPage : undefined;
    const result = await prisma.productRecipe.findMany({
      where,
      include: defaultInclude,
      take: perPage,
      skip
    });
    const totalRecords = await prisma.productRecipe.count({ where });
    return {
      data: result,
      totalRecord: totalRecords,
      page,
      perPage,
      nextPage: result.length === perPage ? `/api/product-recipes?page=${page + 1}` : undefined
    };
  } catch(e) {
    dbErrorHandle(e);
  }
};

const updatePartialProductRecipe = async (id: number, data: UpdatePartialProductRecipe): Promise<any> => {
  try {
    const { product_id, material_order_id, quantity_needed } = data;
    
    const updateData: any = {};
    if (product_id !== undefined) updateData.product_id = product_id;
    if (material_order_id !== undefined) updateData.material_order_id = material_order_id;
    if (quantity_needed !== undefined) updateData.quantity_needed = quantity_needed;
    
    return await prisma.productRecipe.update({
      where: { id },
      data: updateData,
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const deleteProductRecipe = async (id: number): Promise<any> => {
  try {
    return await prisma.productRecipe.delete({ 
      where: { id }, 
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getRecipesByProduct = async (productId: number): Promise<any[]> => {
  try {
    return await prisma.productRecipe.findMany({
      where: { product_id: productId },
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

export default {
  createProductRecipe,
  getProductRecipe,
  getProductRecipes,
  updatePartialProductRecipe,
  deleteProductRecipe,
  getRecipesByProduct
};
