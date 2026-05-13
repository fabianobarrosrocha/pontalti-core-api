import { Router } from "express";
import createHttpError from "http-errors";
import productService from "@pontalti/modules/v1/products/product-service";
import {
  createProductSchema,
  updateProductSchema,
  generateProductsSchema
} from "@pontalti/modules/v1/products/product-schema";
import { validate } from "@pontalti/utils/validator";

const routes = Router();

routes.post("/generate", validate(generateProductsSchema), (req, res, next) => {
  productService
    .generateProducts(req.body)
    .then((result) => res.status(201).json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.post("/", validate(createProductSchema), (req, res, next) => {
  productService
    .createProduct(req.body)
    .then((result) => res.status(201).json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.get("/", (req, res, next) => {
  productService
    .getAllProducts(req.params)
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.get("/:id", (req, res, next) => {
  productService
    .getProductById(Number(req.params.id))
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.patch("/:id", validate(updateProductSchema), (req, res, next) => {
  productService
    .updatePartialProduct(Number(req.params.id), req.body)
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.delete("/:id", (req, res, next) => {
  productService
    .deleteProduct(Number(req.params.id))
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

export default routes;
