import { NextFunction, Request, Response, Router } from "express";
import createHttpError from "http-errors";
import orderService from "@pontalti/modules/v1/orders/order-service";
import { createOrderSchema } from "@pontalti/modules/v1/orders/order-schema"
import { validate } from "@pontalti/utils/validator";

const routes = Router();

routes.post('/', validate(createOrderSchema), (req, res, next) => {
  orderService.createOrder(req.body.order, req.body.products)
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

routes.get('/', (req, res, next) => {
  orderService.getAllOrders(req.query as never)
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

routes.get('/:id', (req, res, next) => {
  const id = req.params.id;
  orderService.getOrderById(Number(id))
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

routes.patch('/:id', (req, res, next) => {
  orderService.updatePartialOrder(Number(req.params.id), req.body)
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

routes.delete('/:id', (req, res, next) => {
  orderService.deleteOrder(Number(req.params.id))
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

export default routes
