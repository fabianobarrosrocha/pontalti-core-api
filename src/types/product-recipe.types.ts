import { Product } from "./product.types";
import { MaterialOrder } from "./material-order.types";

export type ProductRecipe = {
  id: number;
  product_id: number;
  material_order_id: number;
  quantity_needed: number;
  created_at: Date;
  updated_at: Date;
  product?: Product;
  material_order?: MaterialOrder;
};

export type ProductRecipeRegister = Omit<ProductRecipe, "id" | "created_at" | "updated_at" | "product" | "material_order">;

export type ProductRecipeRequest = Partial<ProductRecipe> & { 
  page?: number; 
  perPage?: number;
};

export type UpdatePartialProductRecipe = Partial<Omit<ProductRecipe, "id" | "created_at" | "updated_at" | "product" | "material_order">>;
