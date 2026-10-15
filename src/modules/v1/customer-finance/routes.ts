import { timingSafeEqual } from "node:crypto";
import { ErrorRequestHandler, Request, RequestHandler, Router } from "express";
import { Prisma } from "@prisma/client";
import prisma from "@pontalti/lib/prisma";
import { CoraError, getBankingContext } from "@pontalti/integrations/cora/client";
import { requireAdmin } from "@pontalti/middlewares/require-admin";
import { CustomRequest } from "@pontalti/types/common.types";
import { CustomerFinanceService } from "./customer-finance-service";
import { environment, integer, uuid } from "./domain";

export const customerFinanceService = new CustomerFinanceService(prisma);
const handle =
  (fn: (req: Request) => Promise<unknown>, status = 200): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((value) => res.status(status).json(value))
      .catch(next);
  };
const userId = (req: Request) => (req as CustomRequest).user.id;
const adminEnvironment = (req: Request) => environment(req.query.environment ?? getBankingContext().environment);
const internalEnvironment = (req: Request) =>
  environment(req.method === "GET" ? req.query.environment : req.body?.environment);
const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};
export const internalFinanceAuthentication: RequestHandler = (req, res, next) => {
  const token = process.env.CUSTOMER_FINANCE_INTERNAL_TOKEN?.trim();
  const received = req.header("Authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length < 32)
    return res.status(503).json({ message: "A integração de saldo ainda não foi configurada." });
  const expected = Buffer.from(token),
    actual = Buffer.from(received ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return res.status(401).json({ message: "Integração não autorizada." });
  next();
};
const safeError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof CoraError)
    return res
      .status(502)
      .json({ message: "A consulta à Cora não foi concluída. Nenhum crédito foi liberado sem confirmação." });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    return res.status(409).json({ message: "Esta referência ou lançamento já foi utilizado. Atualize a página." });
  if (error.status >= 400 && error.status <= 599)
    return res
      .status(error.status)
      .json({ message: error.message, code: error.code ?? (error.status === 409 ? "FINANCE_CONFLICT" : undefined) });
  return res
    .status(500)
    .json({ message: "Não foi possível concluir a operação. Atualize a página antes de tentar novamente." });
};
export function createAdminFinanceRouter(service = customerFinanceService) {
  const router = Router();
  router.use(requireAdmin, noStore);
  router.get(
    "/customers",
    handle((req) => service.customers(adminEnvironment(req)))
  );
  router.get(
    "/customers/:id/summary",
    handle((req) => service.summary(integer(Number(req.params.id)), adminEnvironment(req)))
  );
  router.get(
    "/customers/:id/statement",
    handle((req) => service.statement(integer(Number(req.params.id)), adminEnvironment(req)))
  );
  router.get(
    "/links",
    handle((req) =>
      service.links(adminEnvironment(req), typeof req.query.status === "string" ? req.query.status : undefined)
    )
  );
  for (const action of ["approve", "reject"] as const)
    router.post(
      `/links/:id/${action}`,
      handle((req) => service.reviewLink(uuid(req.params.id), action, req.body, userId(req)))
    );
  router.get(
    "/approvals",
    handle((req) =>
      service.purchases(adminEnvironment(req), typeof req.query.status === "string" ? req.query.status : undefined)
    )
  );
  router.get(
    "/approvals/:id",
    handle((req) => service.purchase(uuid(req.params.id)))
  );
  for (const action of ["approve", "reject"] as const)
    router.post(
      `/approvals/:id/${action}`,
      handle((req) => service.reviewPurchase(uuid(req.params.id), action, req.body, userId(req)))
    );
  router.post(
    "/approvals/:id/cancel",
    handle((req) => service.cancelPurchase(uuid(req.params.id), req.body, undefined, userId(req)))
  );
  router.post(
    "/approvals/:id/link-order",
    handle((req) => service.linkOrder(uuid(req.params.id), req.body, userId(req)))
  );
  router.post(
    "/approvals/:id/register-order",
    handle((req) => service.registerOrder(uuid(req.params.id), req.body, userId(req)))
  );
  router.get(
    "/deposits",
    handle((req) =>
      service.deposits(adminEnvironment(req), typeof req.query.status === "string" ? req.query.status : undefined)
    )
  );
  router.get(
    "/deposits/:id",
    handle((req) => service.deposit(uuid(req.params.id)))
  );
  router.post(
    "/deposits/:id/sync",
    handle((req) => service.syncDeposit(uuid(req.params.id)))
  );
  for (const action of ["confirm", "reject"] as const)
    router.post(
      `/deposits/:id/${action}`,
      handle((req) => service.reviewDeposit(uuid(req.params.id), action, req.body, userId(req)))
    );
  router.get(
    "/bank-entries",
    handle((req) => service.bankEntries(adminEnvironment(req)))
  );
  router.post(
    "/bank-entries/sync",
    handle((req) => service.syncBankEntries(String(req.body?.start ?? ""), String(req.body?.end ?? "")))
  );
  router.use(safeError);
  return router;
}
export function createInternalFinanceRouter(service = customerFinanceService) {
  const router = Router();
  router.use(internalFinanceAuthentication, noStore);
  router.post(
    "/customers/link",
    handle((req) => service.link(req.body))
  );
  router.get(
    "/customers/:id/link",
    handle((req) => service.externalLink(uuid(req.params.id), internalEnvironment(req)))
  );
  router.get(
    "/customers/:id/summary",
    handle((req) => service.externalSummary(uuid(req.params.id), internalEnvironment(req)))
  );
  router.get(
    "/customers/:id/statement",
    handle((req) => service.externalStatement(uuid(req.params.id), internalEnvironment(req)))
  );
  router.get(
    "/customers/:id/deposits",
    handle((req) => service.externalDeposits(uuid(req.params.id), internalEnvironment(req)))
  );
  router.post(
    "/purchases",
    handle((req) => service.createPurchase(req.body), 201)
  );
  router.get(
    "/purchases/by-order/:id",
    handle((req) => service.purchaseByOrder(uuid(req.params.id), internalEnvironment(req)))
  );
  router.get(
    "/purchases/:id",
    handle(async (req) => {
      const result = await service.purchase(uuid(req.params.id));
      if (result.environment !== internalEnvironment(req))
        return Promise.reject(Object.assign(new Error("Solicitação não encontrada."), { status: 404 }));
      return result;
    })
  );
  router.post(
    "/purchases/:id/renew-consent",
    handle((req) => service.renewConsent(uuid(req.params.id), req.body, internalEnvironment(req)))
  );
  router.post(
    "/purchases/:id/cancel",
    handle((req) => service.cancelPurchase(uuid(req.params.id), req.body, internalEnvironment(req)))
  );
  router.post(
    "/purchases/:id/link-order",
    handle((req) => service.linkOrder(uuid(req.params.id), req.body, null, internalEnvironment(req)))
  );
  router.post(
    "/deposit-claims",
    handle((req) => service.createDeposit(req.body, "BANK_CLAIM"), 201)
  );
  router.post(
    "/deposits",
    handle((req) => service.createDeposit(req.body, "BOLETO"), 201)
  );
  router.get(
    "/deposits/:id",
    handle((req) => service.deposit(uuid(req.params.id), internalEnvironment(req)))
  );
  router.post(
    "/deposits/:id/sync",
    handle((req) => service.syncDeposit(uuid(req.params.id), internalEnvironment(req)))
  );
  router.use(safeError);
  return router;
}
