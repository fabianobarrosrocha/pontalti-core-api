import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import prisma from "@pontalti/lib/prisma";
import { CoraError, CoraGateway, BankingContext } from "@pontalti/integrations/cora/client";
import AuthenticationHandler from "@pontalti/middlewares/authentication-handler";
import expenseService from "@pontalti/modules/v1/expenses/expense-service";
import { BankingService } from "./banking-service";
import { PaymentService } from "./payment-service";
import { createBankingRouter, createBankingWebhook } from "./routes";
import { RemoteTransfer, TransferPayload } from "./banking-domain";

const testUrl = process.env.BANKING_TEST_DATABASE_URL;
if (!testUrl || process.env.DATABASE_URL !== testUrl) throw Error("Use the explicit disposable test database.");
const parsed = new URL(testUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/pontalti_cora_test")
  throw Error("Refusing non-test database.");
process.env.PRIVATE_KEY = "payments-tests-only";
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });
const now = new Date("2026-10-15T12:00:00Z");
class FakeCora implements CoraGateway {
  settings: BankingContext = {
    environment: "PRODUCTION",
    connectionKey: "test-payments",
    configured: true,
    transfersEnabled: true,
    workerEnabled: true
  };
  calls: { payload: TransferPayload; key: string }[] = [];
  remote: RemoteTransfer[] = [];
  error: CoraError | null = null;
  context = () => this.settings;
  account = async () => ({});
  banks = async () => [];
  balance = async () => 1000000;
  statement = async () => ({});
  async initiateTransfer(payload: TransferPayload, key: string) {
    this.calls.push({ payload, key });
    if (this.error) throw this.error;
    const response = { ...payload, id: `trn_${payload.code}`, status: "INITIATED" };
    this.remote.push(response);
    return response;
  }
  async transfers(status: string, _start: string, _end: string, page: number) {
    return { content: page ? [] : this.remote.filter((row) => row.status === status), hasMore: false };
  }
}
let cora: FakeCora;
let service: PaymentService;
let banking: BankingService;
let userId: number;
let employeeId: number;
let vendorId: number;
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "Users", "Employees", "Vendors", "Adresses", "Expenses", "ExpenseActor", "BankBeneficiary", "BankWebhookEvent" RESTART IDENTITY CASCADE'
  );
  userId = (
    await db.users.create({
      data: { name: "Admin", email: "admin@example.test", password: "test", access_level: "administrator" }
    })
  ).id;
  employeeId = (
    await db.employees.create({
      data: {
        name: "Funcionário teste",
        email: "person@example.test",
        cpf: "52998224725",
        phone: "",
        cel_number: "",
        classification: 1,
        admission: now
      }
    })
  ).id;
  const address = await db.adresses.create({
    data: {
      zip_code: "00000000",
      neighborhood: "Teste",
      public_place: "Rua",
      city: "Teste",
      state: "SP",
      address_number: 1
    }
  });
  vendorId = (
    await db.vendors.create({
      data: {
        name: "Fornecedor teste",
        cnpj: "11222333000181",
        store_name: "Teste",
        status: 1,
        deliver: false,
        volume_purchases: 1,
        purchases: 1,
        invoicing: 1,
        address_id: address.id,
        updated_at: now
      }
    })
  ).id;
  cora = new FakeCora();
  service = new PaymentService(db, cora, () => now);
  banking = new BankingService(db, cora, () => now);
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});
async function beneficiary(kind: "employee" | "vendor" | "other" = "employee") {
  return service.saveBeneficiary(
    null,
    {
      version: 0,
      active: true,
      name: kind === "vendor" ? "Fornecedor teste" : kind === "employee" ? "Funcionário teste" : "Pessoa externa",
      document: kind === "vendor" ? "11222333000181" : kind === "employee" ? "52998224725" : "11144477735",
      document_type: kind === "vendor" ? "CNPJ" : "CPF",
      employee_id: kind === "employee" ? employeeId : null,
      vendor_id: kind === "vendor" ? vendorId : null,
      bank_code: "260",
      branch_number: "0001",
      account_number: "12345678",
      account_type: "CHECKING"
    },
    userId
  );
}
const receipt = {
  name: "compra.pdf",
  mime: "application/pdf",
  content_base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64")
};
async function payable(person?: Awaited<ReturnType<typeof beneficiary>>, amount = 100000) {
  const target = person ?? (await beneficiary());
  const row = await service.createPayable(
    {
      id: randomUUID(),
      purpose: target.vendor_id ? "SUPPLIER" : "REIMBURSEMENT",
      beneficiary_id: target.id,
      due_date: "2026-10-20",
      justification: "Material comprado para a fábrica",
      expense: {
        amount_cents: amount,
        description: "Compra de material",
        classification: "Material",
        expense_date: "2026-10-15"
      }
    },
    userId
  );
  if (!target.vendor_id) await service.addReceipt(row.id, receipt, userId);
  const current = await service.payable(row.id);
  return service.payableAction(row.id, "approve", { version: current.version }, userId);
}
const paymentInput = (payableId: string, amount = 40000) => ({
  id: randomUUID(),
  payment_date: "2026-10-20",
  items: [{ payable_id: payableId, amount_cents: amount }]
});
async function submitted(payableId: string, amount = 40000) {
  const payment = await service.createPayment(paymentInput(payableId, amount), userId);
  await service.paymentAction(payment.id, "release", { version: payment.version }, userId);
  await service.dispatch(payment.id);
  return { payment, remote: cora.remote[cora.remote.length - 1] };
}

test("PF/PJ and external beneficiaries use valid documents and canonical linked identity", async () => {
  const company = await beneficiary("vendor");
  const employee = await beneficiary();
  const other = await beneficiary("other");
  assert.equal(company.document_type, "CNPJ");
  assert.equal(employee.employee_id, employeeId);
  assert.equal(other.employee_id, null);
  assert.ok(!JSON.stringify(await service.beneficiaries()).includes("52998224725"));
  const { id, created_at, updated_at, ...input } = await service.beneficiary(employee.id);
  await assert.rejects(service.saveBeneficiary(employee.id, { ...input, document: "00000000000" }, userId));
  await assert.rejects(service.saveBeneficiary(employee.id, { ...input, name: "Outra pessoa" }, userId));
});
test("reimbursement approval requires a bounded authentic-format receipt", async () => {
  const target = await beneficiary("other");
  const row = await service.createPayable(
    {
      id: randomUUID(),
      purpose: "REIMBURSEMENT",
      beneficiary_id: target.id,
      due_date: "2026-10-20",
      justification: "Compra adiantada",
      expense: { amount_cents: 10000, description: "Material", classification: "Material", expense_date: "2026-10-15" }
    },
    userId
  );
  await assert.rejects(service.payableAction(row.id, "approve", { version: row.version }, userId));
  await assert.rejects(
    service.addReceipt(
      row.id,
      { ...receipt, content_base64: Buffer.from("<script>bad</script>").toString("base64") },
      userId
    )
  );
  const file = await service.addReceipt(row.id, receipt, userId);
  const downloaded = await service.receipt(row.id, file.id);
  assert.equal(downloaded.content_base64, receipt.content_base64);
  const current = await service.payable(row.id);
  await service.payableAction(row.id, "approve", { version: current.version }, userId);
  await assert.rejects(service.addReceipt(row.id, receipt, userId));
});
test("supplier and reimbursement obligations do not duplicate an existing expense", async () => {
  const vendor = await beneficiary("vendor");
  const row = await payable(vendor);
  assert.equal(await db.expenses.count(), 1);
  await assert.rejects(
    service.createPayable(
      {
        id: randomUUID(),
        purpose: "SUPPLIER",
        beneficiary_id: vendor.id,
        expense_id: row.expense_id,
        due_date: "2026-10-20",
        justification: "Tentativa duplicada"
      },
      userId
    )
  );
  const { payment, remote } = await submitted(row.id);
  await Promise.all([
    service.applyRemote(payment.id, { ...remote, status: "COMPLETED" }),
    service.applyRemote(payment.id, { ...remote, status: "COMPLETED" })
  ]);
  const balance = await service.payable(row.id);
  assert.equal(balance.paid_cents, 40000);
  assert.equal(balance.remaining_cents, 60000);
  assert.equal(await db.expenses.count(), 1);
  assert.equal(await db.bankNotification.count({ where: { payment_id: payment.id, status: "COMPLETED" } }), 1);
  assert.notEqual(cora.calls[0].payload.category, "PAYROLL");
});
test("concurrent partial payments reserve at most the remaining amount", async () => {
  const row = await payable();
  const result = await Promise.allSettled([
    service.createPayment(paymentInput(row.id, 60000), userId),
    service.createPayment(paymentInput(row.id, 60000), userId)
  ]);
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal((await service.payable(row.id)).available_cents, 40000);
});
test("draft idempotency and cancellation preserve and release reservations exactly once", async () => {
  const row = await payable();
  const input = paymentInput(row.id);
  const [first, second] = await Promise.all([
    service.createPayment(input, userId),
    service.createPayment(input, userId)
  ]);
  assert.equal(first.id, second.id);
  assert.equal((await service.payable(row.id)).reserved_cents, 40000);
  await assert.rejects(
    service.createPayment({ ...input, items: [{ payable_id: row.id, amount_cents: 20000 }] }, userId)
  );
  await service.paymentAction(first.id, "cancel", { version: first.version }, userId);
  assert.equal((await service.payable(row.id)).available_cents, 100000);
  assert.equal(cora.calls.length, 0);
});
test("multiple expenses of one beneficiary share one TED with separate partial balances", async () => {
  const target = await beneficiary();
  const first = await payable(target, 100000);
  const second = await payable(target, 50000);
  const payment = await service.createPayment(
    {
      id: randomUUID(),
      payment_date: "2026-10-20",
      items: [
        { payable_id: first.id, amount_cents: 30000 },
        { payable_id: second.id, amount_cents: 20000 }
      ]
    },
    userId
  );
  await service.paymentAction(payment.id, "release", { version: payment.version }, userId);
  await Promise.all([service.dispatch(payment.id), service.dispatch(payment.id)]);
  assert.equal(cora.calls.length, 1);
  assert.equal(cora.calls[0].payload.amount, 50000);
  await service.applyRemote(payment.id, { ...cora.remote[0], status: "COMPLETED" });
  assert.equal((await service.payable(first.id)).available_cents, 70000);
  assert.equal((await service.payable(second.id)).available_cents, 30000);
});
test("mixed beneficiaries, duplicate allocations and invalid amounts are rejected", async () => {
  const first = await payable();
  const second = await payable(await beneficiary("other"));
  await assert.rejects(
    service.createPayment(
      {
        id: randomUUID(),
        payment_date: "2026-10-20",
        items: [
          { payable_id: first.id, amount_cents: 100 },
          { payable_id: second.id, amount_cents: 100 }
        ]
      },
      userId
    )
  );
  await assert.rejects(
    service.createPayment(
      {
        id: randomUUID(),
        payment_date: "2026-10-20",
        items: [
          { payable_id: first.id, amount_cents: 100 },
          { payable_id: first.id, amount_cents: 100 }
        ]
      },
      userId
    )
  );
  await assert.rejects(service.createPayment(paymentInput(first.id, 0), userId));
  await assert.rejects(service.createPayment(paymentInput(first.id, 100001), userId));
});
test("timeouts keep reservations and cannot be retried or cancelled before authenticated reconciliation", async () => {
  const row = await payable();
  cora.error = new CoraError(true, false);
  const { payment } = await submitted(row.id);
  let current = await service.payment(payment.id);
  assert.equal(current.status, "UNKNOWN");
  await assert.rejects(service.paymentAction(payment.id, "retry", { version: current.version }, userId));
  await assert.rejects(service.paymentAction(payment.id, "cancel", { version: current.version }, userId));
  assert.equal((await service.payable(row.id)).reserved_cents, 40000);
  const remote = { ...cora.calls[0].payload, id: "trn_recovered", status: "COMPLETED" };
  cora.remote.push(remote);
  await service.sync(payment.id);
  current = await service.payment(payment.id);
  assert.equal(current.status, "COMPLETED");
  assert.equal(cora.calls.length, 1);
});
test("definite failure retry uses the same idempotency key and rejected TED releases balance", async () => {
  const row = await payable();
  cora.error = new CoraError(false, true, 401);
  const { payment } = await submitted(row.id);
  const current = await service.payment(payment.id);
  assert.equal(current.status, "FAILED");
  cora.error = null;
  await service.paymentAction(payment.id, "retry", { version: current.version }, userId);
  await service.dispatch(payment.id);
  assert.equal(cora.calls[0].key, cora.calls[1].key);
  await service.applyRemote(payment.id, { ...cora.remote[0], status: "REJECTED" });
  assert.equal((await service.payable(row.id)).available_cents, 100000);
});
test("mismatch never settles; duplicate and late refunds reopen only the affected partial balance", async () => {
  const row = await payable();
  const { payment, remote } = await submitted(row.id);
  await service.applyRemote(payment.id, { ...remote, amount: remote.amount + 1, status: "COMPLETED" });
  assert.equal((await service.payment(payment.id)).status, "UNKNOWN");
  await service.applyRemote(payment.id, { ...remote, status: "COMPLETED" });
  await service.applyRemote(payment.id, { ...remote, status: "REFUNDED" });
  await service.applyRemote(payment.id, { ...remote, status: "REFUNDED" });
  await service.applyRemote(payment.id, { ...remote, status: "COMPLETED" });
  assert.equal((await service.payment(payment.id)).status, "REFUNDED");
  assert.equal((await service.payable(row.id)).available_cents, 100000);
  assert.equal(await db.expenses.count(), 1);
  assert.equal(await db.bankNotification.count({ where: { payment_id: payment.id, status: "REFUNDED" } }), 1);
});
test("account edits and stale approvals prevent dispatch, and expense edits cannot invalidate balances", async () => {
  const target = await beneficiary();
  const row = await payable(target);
  const payment = await service.createPayment(paymentInput(row.id), userId);
  const { id, created_at, updated_at, ...detail } = await service.beneficiary(target.id);
  await service.saveBeneficiary(target.id, { ...detail, account_number: "9999999" }, userId);
  await assert.rejects(service.paymentAction(payment.id, "release", { version: payment.version }, userId));
  assert.equal(cora.calls.length, 0);
  await assert.rejects(expenseService.updatePartialExpense(row.expense_id, { amount: "1.00" }));
  await assert.rejects(expenseService.deleteExpense(row.expense_id));
});
test("drafts never auto-send; expired submissions retain reservation after worker recovery", async () => {
  const row = await payable();
  const payment = await service.createPayment(paymentInput(row.id), userId);
  await service.tick();
  assert.equal(cora.calls.length, 0);
  await db.bankPayment.update({
    where: { id: payment.id },
    data: { status: "SUBMITTING", attempts: 1, lease_until: new Date(now.getTime() - 1000) }
  });
  await service.tick();
  assert.equal((await service.payment(payment.id)).status, "UNKNOWN");
  assert.equal((await service.payable(row.id)).reserved_cents, 40000);
});
test("webhooks request authenticated reads and unified notifications link the correct resource", async () => {
  const row = await payable();
  const { payment, remote } = await submitted(row.id);
  await banking.webhook("evt_test", remote.id, "transfer.completed");
  assert.equal((await service.payment(payment.id)).status, "INITIATED");
  cora.remote[0].status = "COMPLETED";
  await service.tick();
  const notifications = await banking.notifications.list(userId, {});
  const item = notifications.items.find((item) => item.status === "COMPLETED");
  assert.equal(item.payment_id, payment.id);
  assert.equal(item.run_id, null);
  assert.equal(item.purpose, "REIMBURSEMENT");
});
test("connection isolation, stage simulation and disabled sending preserve financial boundaries", async () => {
  const row = await payable();
  const { payment, remote } = await submitted(row.id);
  cora.settings.connectionKey = "other-connection";
  await assert.rejects(service.payment(payment.id));
  await assert.rejects(service.applyRemote(payment.id, { ...remote, status: "COMPLETED" }));
  cora.settings.connectionKey = "test-payments";
  cora.settings.transfersEnabled = false;
  const draft = await service.createPayment(paymentInput(row.id, 10000), userId);
  await assert.rejects(service.paymentAction(draft.id, "release", { version: draft.version }, userId));
  cora.settings.transfersEnabled = true;
  cora.settings.environment = "STAGE";
  cora.settings.connectionKey = "stage-test";
  const stage = await payable(await beneficiary("other"), 10000);
  const sent = await submitted(stage.id, 1000);
  const expenseCount = await db.expenses.count();
  await service.applyRemote(sent.payment.id, { ...sent.remote, status: "COMPLETED" });
  assert.equal(await db.expenses.count(), expenseCount);
  assert.equal((await service.payment(sent.payment.id)).environment, "STAGE");
});
test("HTTP permissions protect beneficiaries, payment actions and private receipts", async () => {
  await db.users.create({
    data: { name: "Padrão", email: "standard@example.test", password: "test", access_level: "standard" }
  });
  const app = express();
  app.use(express.json());
  app.use("/api/v1/banking/webhook", createBankingWebhook(banking));
  app.use(AuthenticationHandler);
  app.use("/api/v1/banking", createBankingRouter(banking));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/banking`;
  const token = (email: string) => jwt.sign({ email }, process.env.PRIVATE_KEY, { expiresIn: "1m" });
  try {
    for (const path of ["beneficiaries", "payables", "payments", "beneficiaries/references", "payables/expenses"]) {
      assert.equal((await fetch(`${base}/${path}`)).status, 401);
      assert.equal(
        (await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token("standard@example.test")}` } }))
          .status,
        403
      );
      assert.equal(
        (await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token("admin@example.test")}` } }))
          .status,
        200
      );
    }
    assert.equal(
      (
        await fetch(`${base}/payments/${randomUUID()}/release`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token("standard@example.test")}` }
        })
      ).status,
      403
    );
    assert.equal((await fetch(`${base}/payables/${randomUUID()}/receipts/${randomUUID()}`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/payables/${randomUUID()}/receipts/${randomUUID()}`, {
          headers: { Authorization: `Bearer ${token("standard@example.test")}` }
        })
      ).status,
      403
    );
    assert.equal(cora.calls.length, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("late completion revalidates reservations before another queued payment can be sent", async () => {
  const row = await payable();
  const first = await submitted(row.id, 40000);
  await service.applyRemote(first.payment.id, { ...first.remote, status: "REJECTED" });
  const replacement = await service.createPayment(paymentInput(row.id, 100000), userId);
  await service.paymentAction(replacement.id, "release", { version: replacement.version }, userId);
  await service.applyRemote(first.payment.id, { ...first.remote, status: "COMPLETED" });
  await service.dispatch(replacement.id);
  assert.equal((await service.payment(replacement.id)).status, "FAILED");
  assert.equal(await db.bankNotification.count({ where: { payment_id: replacement.id, status: "FAILED" } }), 1);
  assert.equal(cora.calls.length, 1);
});

test("a canonical name correction permits future payments without changing historical snapshots", async () => {
  const target = await beneficiary();
  const row = await payable(target);
  const draft = await service.createPayment(paymentInput(row.id), userId);
  await db.employees.update({ where: { id: employeeId }, data: { name: "Nome corrigido" } });
  const { id, created_at, updated_at, ...account } = await service.beneficiary(target.id);
  await service.saveBeneficiary(target.id, { ...account, name: "Nome corrigido" }, userId);
  await assert.rejects(service.paymentAction(draft.id, "release", { version: draft.version }, userId));
  await service.paymentAction(draft.id, "cancel", { version: draft.version }, userId);
  const replacement = await service.createPayment(paymentInput(row.id), userId);
  assert.equal(replacement.beneficiary_name, "Nome corrigido");
  assert.equal((await service.payment(draft.id)).beneficiary_name, "Funcionário teste");
});

test("revisions update one original expense, reset approval and reject stale or reserved changes", async () => {
  const row = await payable();
  const revisedBody = {
    version: row.version,
    beneficiary_id: row.beneficiary_id,
    due_date: "2026-10-21",
    justification: "Valor corrigido antes do envio",
    expense: {
      amount_cents: 90000,
      description: "Despesa revisada",
      classification: "Material",
      expense_date: "2026-10-15"
    }
  };
  const revised = await service.revisePayable(row.id, revisedBody, userId);
  assert.equal(revised.status, "DRAFT");
  assert.equal(revised.total_cents, 90000);
  assert.equal((await db.expenses.findUnique({ where: { id: row.expense_id } })).amount.toString(), "900");
  assert.equal(await db.expenses.count(), 1);
  await assert.rejects(service.revisePayable(row.id, revisedBody, userId));
  const approved = await service.payableAction(row.id, "approve", { version: revised.version }, userId);
  const payment = await service.createPayment(paymentInput(row.id), userId);
  await assert.rejects(service.revisePayable(row.id, { ...revisedBody, version: approved.version }, userId));
  await service.paymentAction(payment.id, "cancel", { version: payment.version }, userId);
  const again = await service.revisePayable(row.id, { ...revisedBody, version: approved.version }, userId);
  assert.equal(again.status, "DRAFT");
  await service.payableAction(row.id, "approve", { version: again.version }, userId);
  await submitted(row.id);
  const current = await service.payable(row.id);
  await assert.rejects(service.revisePayable(row.id, { ...revisedBody, version: current.version }, userId));
});

test("removing a draft receipt preserves audit and requires another proof before approval", async () => {
  const approved = await payable();
  const revision = await service.revisePayable(
    approved.id,
    {
      version: approved.version,
      beneficiary_id: approved.beneficiary_id,
      due_date: "2026-10-20",
      justification: "Conferir comprovante correto",
      expense: {
        amount_cents: 100000,
        description: "Compra de material",
        classification: "Material",
        expense_date: "2026-10-15"
      }
    },
    userId
  );
  const cleared = await service.removeReceipt(
    revision.id,
    revision.receipts[0].id,
    { version: revision.version },
    userId
  );
  assert.equal(cleared.receipts.length, 0);
  assert.ok(cleared.audit.some((event) => event.action === "PAYABLE_RECEIPT_REMOVED"));
  await assert.rejects(service.payableAction(cleared.id, "approve", { version: cleared.version }, userId));
});
