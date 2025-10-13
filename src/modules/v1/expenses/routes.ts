import { Router } from "express";
import createHttpError from "http-errors";
import service from "@pontalti/modules/v1/expenses/expense-service";
import { validate } from "@pontalti/utils/validator";
import { expenseCreateSchema, expenseUpdateSchema, expenseQuerySchema } from "@pontalti/modules/v1/expenses/expense-schema";

const router = Router();

router.post("/", validate(expenseCreateSchema), (req, res, next) => {
  service.createExpense(req.body, req as any)
    .then(result => res.status(201).json(result))
    .catch(e => next(createHttpError(e)));
});

router.get("/", validate(expenseQuerySchema), (req, res, next) => {
  service.getExpenses(req.query)
    .then(result => res.json(result))
    .catch(e => next(createHttpError(e)));
});

router.get("/:id", (req, res, next) => {
  service.getExpense(Number(req.params.id))
    .then(result => res.json(result))
    .catch(e => next(createHttpError(e)));
});

router.patch("/:id", validate(expenseUpdateSchema), (req, res, next) => {
  service.updatePartialExpense(Number(req.params.id), req.body, req as any)
    .then(result => res.json(result))
    .catch(e => next(createHttpError(e)));
});

router.delete("/:id", (req, res, next) => {
  service.deleteExpense(Number(req.params.id))
    .then(result => res.json(result))
    .catch(e => next(createHttpError(e)));
});

export default router;


