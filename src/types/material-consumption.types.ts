import { ProductionControl } from "./production-control.types";
import { MaterialOrder } from "./material-order.types";

export type MaterialConsumption = {
  id: number;
  production_control_id: number;
  material_order_id: number;
  planned_consumption: number;
  actual_consumption?: number;
  variance?: number;
  consumption_date?: Date;
  created_at: Date;
  updated_at: Date;
  production_control?: ProductionControl;
  material_order?: MaterialOrder;
};

export type MaterialConsumptionRegister = Omit<MaterialConsumption, "id" | "created_at" | "updated_at" | "production_control" | "material_order">;

export type MaterialConsumptionRequest = Partial<MaterialConsumption> & { 
  page?: number; 
  perPage?: number;
};

export type UpdatePartialMaterialConsumption = Partial<Omit<MaterialConsumption, "id" | "created_at" | "updated_at" | "production_control" | "material_order">>;
