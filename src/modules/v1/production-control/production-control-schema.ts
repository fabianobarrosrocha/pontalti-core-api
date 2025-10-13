import * as yup from "yup";

export const productionControlSchema = yup.object().shape({
  order_id: yup.number().required(),
  status: yup.number().required(),
  material_disponibility: yup.number().required(),
  estimated_start_date: yup.date().optional(),
  estimated_end_date: yup.date().optional(),
  actual_start_date: yup.date().optional(),
  actual_end_date: yup.date().optional(),
  production_priority: yup.number().min(1).max(4).optional().default(3),
  observations: yup.string().optional()
});

export const productionControlUpdateSchema = yup.object().shape({
  status: yup.number().optional(),
  material_disponibility: yup.number().optional(),
  estimated_start_date: yup.date().optional(),
  estimated_end_date: yup.date().optional(),
  actual_start_date: yup.date().optional(),
  actual_end_date: yup.date().optional(),
  production_priority: yup.number().min(1).max(4).optional(),
  observations: yup.string().optional()
});

export const productRecipeSchema = yup.object().shape({
  product_id: yup.number().required(),
  material_order_id: yup.number().required(),
  quantity_needed: yup.number().min(0).required()
});

export const materialConsumptionSchema = yup.object().shape({
  production_control_id: yup.number().required(),
  material_order_id: yup.number().required(),
  planned_consumption: yup.number().min(0).required(),
  actual_consumption: yup.number().min(0).optional(),
  variance: yup.number().optional(),
  consumption_date: yup.date().optional()
}); 