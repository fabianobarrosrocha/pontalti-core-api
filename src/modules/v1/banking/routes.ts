import { ErrorRequestHandler, Request, RequestHandler, Router } from "express";
import { Prisma } from "@prisma/client";
import { ValidationError } from "yup";
import createError from "http-errors";
import prisma from "@pontalti/lib/prisma";
import { requireAdmin } from "@pontalti/middlewares/require-admin";
import { HttpCoraGateway, CoraError } from "@pontalti/integrations/cora/client";
import { CustomRequest } from "@pontalti/types/common.types";
import { BankingService } from "./banking-service";
import { validateBody, validateUuid, versionSchema } from "./banking-schema";

export const bankingService = new BankingService(prisma, new HttpCoraGateway());
const userId = (req: Request) => (req as CustomRequest).user.id;
const employeeId = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(400, "Funcionário inválido.");
  return id;
};
const handle = (fn: (req: Request) => Promise<unknown>, status = 200): RequestHandler =>
  (req, res, next) => { Promise.resolve().then(() => fn(req)).then((value) => res.status(status).json(value)).catch(next); };

const bankingError: ErrorRequestHandler = (error, req, res, next) => {
  if (error instanceof ValidationError) return res.status(400).json({ message: "Confira os dados informados.", errors: error.errors });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return res.status(409).json({ message: "Este cadastro, despesa ou referência já possui uma operação registrada. Atualize a lista." });
  }
  if (error instanceof CoraError) return res.status(502).json({ message: error.message });
  if (error.status >= 400 && error.status < 600) return res.status(error.status).json({ message: error.message });
  // Never return bank responses, SQL parameters, employee account numbers or credentials.
  return res.status(500).json({ message: "Não foi possível concluir a operação financeira. Atualize a página antes de tentar novamente." });
};

export function createBankingRouter(service = bankingService) {
  const router = Router();
  router.use(requireAdmin);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/overview", handle(() => service.overview()));
  router.get("/account", handle(() => service.cora.account()));
  router.get("/balance", handle(async () => ({ balance_cents: await service.cora.balance() })));
  router.get("/banks", handle(() => service.cora.banks()));
  router.get("/beneficiaries/references", handle(() => service.payments.references()));
  router.get("/beneficiaries", handle(() => service.payments.beneficiaries()));
  router.post("/beneficiaries", handle(req => service.payments.saveBeneficiary(null, req.body, userId(req)), 201));
  router.get("/beneficiaries/:id", handle(req => service.payments.beneficiary(validateUuid(req.params.id))));
  router.put("/beneficiaries/:id", handle(req => service.payments.saveBeneficiary(validateUuid(req.params.id), req.body, userId(req))));
  router.get("/payables/expenses", handle(() => service.payments.expenseChoices()));
  router.get("/payables", handle(() => service.payments.payables()));
  router.post("/payables", handle(req => service.payments.createPayable(req.body, userId(req)), 201));
  router.get("/payables/:id", handle(req => service.payments.payable(validateUuid(req.params.id))));
  router.patch("/payables/:id", handle(req => service.payments.revisePayable(validateUuid(req.params.id), req.body, userId(req))));
  for (const action of ["approve", "cancel"] as const) router.post(`/payables/:id/${action}`,
    handle(req => service.payments.payableAction(validateUuid(req.params.id), action, req.body, userId(req))));
  router.post("/payables/:id/receipts", handle(req => service.payments.addReceipt(validateUuid(req.params.id), req.body, userId(req)), 201));
  router.get("/payables/:id/receipts/:receiptId", handle(req => service.payments.receipt(validateUuid(req.params.id), validateUuid(req.params.receiptId))));
  router.post("/payables/:id/receipts/:receiptId/remove", handle(req => service.payments.removeReceipt(validateUuid(req.params.id), validateUuid(req.params.receiptId), req.body, userId(req))));
  router.get("/payments", handle(() => service.payments.payments()));
  router.post("/payments", handle(req => service.payments.createPayment(req.body, userId(req)), 201));
  router.get("/payments/:id", handle(req => service.payments.payment(validateUuid(req.params.id))));
  for (const action of ["release", "cancel", "retry"] as const) router.post(`/payments/:id/${action}`,
    handle(req => service.payments.paymentAction(validateUuid(req.params.id), action, req.body, userId(req)), action === "cancel" ? 200 : 202));
  router.post("/payments/:id/sync", handle(req => service.payments.sync(validateUuid(req.params.id), userId(req))));
  router.get("/notifications", handle((req) => service.notifications.list(userId(req), req.query)));
  router.get("/notifications/summary", handle((req) => service.notifications.summary(userId(req))));
  router.patch("/notifications/read-all", handle((req) => service.notifications.markAllRead(req.body?.before, userId(req))));
  router.patch("/notifications/:id/read", handle((req) => service.notifications.markRead(req.params.id, userId(req))));
  router.get("/statement", handle((req) => service.statement(String(req.query.start ?? ""), String(req.query.end ?? ""), Number(req.query.page ?? 1))));
  router.get("/employees", handle(() => service.employees()));
  router.get("/employees/:id/account", handle((req) => service.account(employeeId(req))));
  router.put("/employees/:id/account", handle((req) => service.saveAccount(employeeId(req), req.body, userId(req))));
  router.get("/payrolls", handle(() => service.payrolls()));
  router.post("/payrolls", handle((req) => service.createPayroll(req.body, userId(req)), 201));
  router.get("/payrolls/:id", handle((req) => service.payroll(validateUuid(req.params.id))));
  router.put("/payrolls/:id", handle((req) => service.revisePayroll(validateUuid(req.params.id), req.body, userId(req))));
  router.patch("/payrolls/:id", handle((req) => service.settings(validateUuid(req.params.id), req.body, userId(req))));
  router.post("/payrolls/:id/release", handle(async (req) => service.release(validateUuid(req.params.id), userId(req), false,
    (await validateBody(versionSchema, req.body)).version), 202));
  router.post("/payrolls/:id/sync", handle((req) => service.sync(validateUuid(req.params.id), userId(req))));
  for (const action of ["cancel", "retry"] as const) router.post(`/payrolls/:id/transfers/:transferId/${action}`,
    handle((req) => service.transferAction(validateUuid(req.params.id), validateUuid(req.params.transferId), action, userId(req))));
  router.use(bankingError);
  return router;
}

export function createBankingWebhook(service = bankingService) {
  const router = Router();
  router.post("/", handle(async (req) => {
    await service.webhook(req.header("webhook-event-id"), req.header("webhook-resource-id"), req.header("webhook-event-type"));
    return { received: true };
  }, 202));
  router.use(bankingError);
  return router;
}

export default createBankingRouter();
