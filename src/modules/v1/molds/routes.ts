import { Router } from "express";
import createHttpError from "http-errors";
import moldService from "@pontalti/modules/v1/molds/mold-service";
import { createMoldSchema, updateMoldSchema } from "@pontalti/modules/v1/molds/mold-schema";
import { validate } from "@pontalti/utils/validator";

const routes = Router();

routes.post("/", validate(createMoldSchema), (req, res, next) => {
  moldService
    .createMold(req.body)
    .then((result) => res.status(201).json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.get("/", (req, res, next) => {
  moldService
    .getAllMolds()
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.get("/:id", (req, res, next) => {
  moldService
    .getMoldById(Number(req.params.id))
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.patch("/:id", validate(updateMoldSchema), (req, res, next) => {
  moldService
    .updatePartialMold(Number(req.params.id), req.body)
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.delete("/:id", (req, res, next) => {
  moldService
    .deleteMold(Number(req.params.id))
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

export default routes;
