import { Order } from "./order.types";
import { Product } from "./product.types";

export type OrderItem = {
  order: Order;
  product: Product;
  quantity: number;
  unit_price: number;
  registered_price?: number | null;
  created_at: Date;
  updated_at: Date;
};

export type OrderItemRegister = Omit<OrderItem, "id" | "created_at" | "updated_at" | "product"> & {
  order_id: number;
  product_id: number;
};

export type ProductIdAndQuantity = {
  id: number;
  quantity: number;
  unit_price: number;
  registered_price?: number | null;
};
