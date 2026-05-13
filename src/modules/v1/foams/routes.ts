import { Router } from "express";
import createHttpError from "http-errors";
import foamService from "@pontalti/modules/v1/foams/foam-service";
import { createFoamSchema, updateFoamSchema } from "@pontalti/modules/v1/foams/foam-schema";
import { validate } from "@pontalti/utils/validator";

const routes = Router();

routes.post("/", validate(createFoamSchema), (req, res, next) => {
  foamService
    .createFoam(req.body)
    .then((result) => res.status(201).json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.get("/", (req, res, next) => {
  foamService
    .getAllFoams()
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.get("/:id", (req, res, next) => {
  foamService
    .getFoamById(Number(req.params.id))
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.patch("/:id", validate(updateFoamSchema), (req, res, next) => {
  foamService
    .updatePartialFoam(Number(req.params.id), req.body)
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.delete("/:id", (req, res, next) => {
  foamService
    .deleteFoam(Number(req.params.id))
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

export default routes;
