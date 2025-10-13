import { MaterialOrder } from "./material-order.types";
import { Product } from "./product.types";
import { ProductionControl } from "./production-control.types";

// Previsão de gastos com materiais
export type MaterialForecast = {
  material_order: MaterialOrder;
  current_stock: number;
  required_quantity: number;
  shortage_quantity: number;
  estimated_cost: number;
  priority: number; // 1: Urgente, 2: Alta, 3: Normal, 4: Baixa
  expected_delivery_date?: Date;
};

// Resumo da previsão de gastos
export type PurchaseForecastSummary = {
  total_estimated_cost: number;
  total_materials: number;
  urgent_materials: number;
  forecasts: MaterialForecast[];
  production_controls: ProductionControl[];
};

// Request para previsão de gastos
export type PurchaseForecastRequest = {
  production_control_ids?: number[]; // IDs específicos de controle de produção
  start_date?: Date; // Data de início para filtrar produções
  end_date?: Date; // Data final para filtrar produções
  include_stock_buffer?: boolean; // Incluir buffer de estoque
  buffer_percentage?: number; // Percentual de buffer (padrão 10%)
};

// Dados para emissão de pedido de compra
export type PurchaseOrderRequest = {
  vendor_id: number;
  material_orders: {
    product_id: number;
    quantity: number;
    unit: string;
    storage_location: string;
    expected_delivery_date?: Date;
    observations?: string;
  }[];
  justification: string;
  priority: number;
  created_by?: string;
};

// Resposta da emissão de pedido
export type PurchaseOrderResponse = {
  created_orders: MaterialOrder[];
  total_estimated_cost: number;
  vendor: {
    id: number;
    name: string;
    store_name: string;
  };
  summary: {
    total_items: number;
    priority: number;
    created_at: Date;
  };
};
