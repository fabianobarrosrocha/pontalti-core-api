import { Order } from "./order.types";
import { MaterialConsumption } from "./material-consumption.types";

export type ProductionControl = {
  id: number;
  order: Order;
  status: number;
  material_disponibility: number;
  estimated_start_date?: Date;
  estimated_end_date?: Date;
  actual_start_date?: Date;
  actual_end_date?: Date;
  production_priority: number;
  observations?: string;
  created_at: Date;
  updated_at: Date;
  material_consumption?: MaterialConsumption[];
};

export type ProductionControlRegister = Omit<ProductionControl, "id" | "created_at" | "updated_at" | "order" | "material_consumption"> & { 
  order_id: number;
};

export type ProductionControlRequest = Partial<ProductionControl> & { 
  page?: number; 
  perPage?: number;
};

export type UpdatePartialProductionControl = Partial<Omit<ProductionControl, "id" | "created_at" | "updated_at" | "order" | "material_consumption">>; 