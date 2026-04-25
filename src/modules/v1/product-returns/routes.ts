import { Router } from "express";
import createHttpError from "http-errors";
import productReturnService from "@pontalti/modules/v1/product-returns/product-return-service";
import { createProductReturnSchema } from "@pontalti/modules/v1/product-returns/product-return-schema";
import { validate } from "@pontalti/utils/validator";

const routes = Router();

routes.post("/", validate(createProductReturnSchema), (req, res, next) => {
  productReturnService
    .createProductReturn(req.body.product_return, req.body.returned_labels)
    .then((result) => {
      res.json(result);
    })
    .catch((e) => {
      const httpError = createHttpError(e);
      next(httpError);
    });
});

routes.get("/", (req, res, next) => {
  productReturnService
    .getAllProductReturns(req.params)
    .then((result) => {
      res.json(result);
    })
    .catch((e) => {
      const httpError = createHttpError(e);
      next(httpError);
    });
});

routes.get("/:id", (req, res, next) => {
  const id = req.params.id;
  productReturnService
    .getProductReturnById(Number(id))
    .then((result) => {
      res.json(result);
    })
    .catch((e) => {
      const httpError = createHttpError(e);
      next(httpError);
    });
});

routes.patch("/:id", (req, res, next) => {
  productReturnService
    .updatePartialProductReturn(Number(req.params.id), req.body)
    .then((result) => {
      res.json(result);
    })
    .catch((e) => {
      const httpError = createHttpError(e);
      next(httpError);
    });
});

routes.delete("/:id", (req, res, next) => {
  productReturnService
    .deleteProductReturn(Number(req.params.id))
    .then((result) => {
      res.json(result);
    })
    .catch((e) => {
      const httpError = createHttpError(e);
      next(httpError);
    });
});

export default routes;
