import * as yup from "yup";
import { Router } from "express";
import purchaseForecastService from "./purchase-forecast-service";
import { 
  purchaseForecastRequestSchema, 
  purchaseOrderRequestSchema,
  purchaseForecastQuerySchema 
} from "./purchase-forecast-schema";
import { validate } from "@pontalti/utils/validator";
import createHttpError from "http-errors";

const router = Router();

// GET /purchase-forecast - Calcular previsão de gastos
router.get("/", validate(yup.object({ query: purchaseForecastQuerySchema })), (req, res, next) => {
  // Converter query params para o formato esperado
  const filters: any = {};
  
  if (req.query.production_control_ids) {
    filters.production_control_ids = (req.query.production_control_ids as string)
      .split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id));
  }
  
  if (req.query.start_date) {
    filters.start_date = new Date(req.query.start_date as string);
  }
  
  if (req.query.end_date) {
    filters.end_date = new Date(req.query.end_date as string);
  }
  
  if (req.query.include_stock_buffer !== undefined) {
    filters.include_stock_buffer = req.query.include_stock_buffer === 'true';
  }
  
  if (req.query.buffer_percentage) {
    filters.buffer_percentage = parseFloat(req.query.buffer_percentage as string);
  }

  purchaseForecastService.calculatePurchaseForecast(filters)
    .then(forecast => res.json(forecast))
    .catch(e => next(createHttpError(e)));
});

// POST /purchase-forecast - Calcular previsão com dados no body
router.post("/calculate", validate(yup.object({ body: purchaseForecastRequestSchema })), (req, res, next) => {
  purchaseForecastService.calculatePurchaseForecast(req.body)
    .then(forecast => res.json(forecast))
    .catch(e => next(createHttpError(e)));
});

// POST /purchase-forecast/create-order - Emitir pedido de compra
router.post("/create-order", validate(yup.object({ body: purchaseOrderRequestSchema })), (req, res, next) => {
  purchaseForecastService.createPurchaseOrder(req.body)
    .then(order => res.status(201).json(order))
    .catch(e => next(createHttpError(e)));
});

export default router;
