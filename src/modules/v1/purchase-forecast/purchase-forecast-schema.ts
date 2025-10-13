import * as yup from "yup";

// Schema para requisição de previsão de gastos
export const purchaseForecastRequestSchema = yup.object().shape({
  production_control_ids: yup.array().of(yup.number()).optional(),
  start_date: yup.date().optional(),
  end_date: yup.date().optional(),
  include_stock_buffer: yup.boolean().optional().default(true),
  buffer_percentage: yup.number().min(0).max(100).optional().default(10)
});

// Schema para validação de item de pedido de compra
const purchaseOrderItemSchema = yup.object().shape({
  product_id: yup.number().required(),
  quantity: yup.number().min(0.01).required(),
  unit: yup.string().required(),
  storage_location: yup.string().required(),
  expected_delivery_date: yup.date().optional(),
  observations: yup.string().optional()
});

// Schema para criação de pedido de compra
export const purchaseOrderRequestSchema = yup.object().shape({
  vendor_id: yup.number().required(),
  material_orders: yup.array().of(purchaseOrderItemSchema).min(1).required(),
  justification: yup.string().required(),
  priority: yup.number().min(1).max(4).required(),
  created_by: yup.string().optional()
});

// Schema para query parameters da previsão
export const purchaseForecastQuerySchema = yup.object().shape({
  production_control_ids: yup.string().optional(), // IDs separados por vírgula
  start_date: yup.string().optional(), // ISO date string
  end_date: yup.string().optional(), // ISO date string
  include_stock_buffer: yup.string().optional(), // "true" or "false"
  buffer_percentage: yup.string().optional() // Número como string
});
