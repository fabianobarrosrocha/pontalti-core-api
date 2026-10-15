import { Customer } from "./customer.types";
import { Product } from "./product.types";

export type Order = {
  id: number;
  final_price: number;
  discount: number;
  date: Date;
  status: number; // 1: Registrado na fábrica (confirmed), 2: Em produção, 3: Enviado, 4: Entregue, 5: Cancelado — espelha os status da loja online
  created_at: Date;
  updated_at: Date;
  customer: Customer;
};

export type OrderRegister = Omit<Order, "id" | "created_at" | "updated_at" | "customer" | "product"> & {
  customer_id: number;
};

export type UpdatePartialOrder = Partial<Order>;
