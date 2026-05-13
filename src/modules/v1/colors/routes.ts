import { Router } from "express";
import createHttpError from "http-errors";
import colorService from "@pontalti/modules/v1/colors/color-service";
import { createColorSchema, updateColorSchema } from "@pontalti/modules/v1/colors/color-schema";
import { validate } from "@pontalti/utils/validator";

const routes = Router();

routes.post("/", validate(createColorSchema), (req, res, next) => {
  colorService
    .createColor(req.body)
    .then((result) => res.status(201).json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.get("/", (req, res, next) => {
  colorService
    .getAllColors()
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.get("/:id", (req, res, next) => {
  colorService
    .getColorById(Number(req.params.id))
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.patch("/:id", validate(updateColorSchema), (req, res, next) => {
  colorService
    .updatePartialColor(Number(req.params.id), req.body)
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

routes.delete("/:id", (req, res, next) => {
  colorService
    .deleteColor(Number(req.params.id))
    .then((result) => res.json(result))
    .catch((e) => next(createHttpError(e)));
});

export default routes;
