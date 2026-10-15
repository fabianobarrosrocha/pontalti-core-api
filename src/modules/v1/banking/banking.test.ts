import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import prisma from "@pontalti/lib/prisma";
import AuthenticationHandler from "@pontalti/middlewares/authentication-handler";
import { BankingService } from "./banking-service";
import { createBankingRouter, createBankingWebhook } from "./routes";
import { BankingContext, CoraError, CoraGateway } from "@pontalti/integrations/cora/client";
import { matchesTransfer, RemoteTransfer, saoPauloInstant, TransferPayload } from "./banking-domain";
import expenseService from "@pontalti/modules/v1/expenses/expense-service";

// This suite truncates its own disposable database. Never accept the app's normal DATABASE_URL.
const testUrl = process.env.BANKING_TEST_DATABASE_URL;
if (!testUrl || process.env.DATABASE_URL !== testUrl) throw new Error("Set DATABASE_URL and BANKING_TEST_DATABASE_URL to the same disposable test database.");
const parsedUrl = new URL(testUrl);
if (!["localhost", "127.0.0.1"].includes(parsedUrl.hostname) || parsedUrl.pathname !== "/pontalti_cora_test") {
  throw new Error("Banking tests require a local database named pontalti_cora_test.");
}
process.env.PRIVATE_KEY = "banking-tests-only-not-a-real-secret";
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });
const instant = new Date("2026-09-16T15:00:00Z");

class FakeCora implements CoraGateway {
  settings: BankingContext = { environment: "PRODUCTION", connectionKey: "fake-test-account", configured: true, transfersEnabled: true, workerEnabled: true };
  calls: { payload: TransferPayload; key: string }[] = [];
  remote: RemoteTransfer[] = [];
  error: CoraError | null = null;
  context = () => this.settings;
  account = async () => ({ name: "Empresa de teste" });
  banks = async () => ({ banks: [] });
  balance = async () => 500000;
  statement = async () => ({ entries: [], start: { balance: 0 }, end: { balance: 0 } });
  async initiateTransfer(payload: TransferPayload, key: string) {
    this.calls.push({ payload: structuredClone(payload), key });
    if (this.error) throw this.error;
    const remote = { ...payload, id: `trn_${payload.code}`, status: "INITIATED" };
    this.remote.push(remote);
    return remote;
  }
  async transfers(status: string, start: string, end: string, page: number) {
    return { content: page ? [] : this.remote.filter((entry) => entry.status === status), hasMore: false };
  }
}

let cora: FakeCora;
let service: BankingService;
let employeeId: number;
let adminId: number;
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "BankWebhookEvent", "FinancialAuditEvent", "BankTransfer", "BankPayrollRun", "BankEmployeeAccount", "Expenses", "ExpenseActor", "Employees", "Users" RESTART IDENTITY CASCADE');
  const admin = await db.users.create({ data: { name: "Administrador teste", email: "admin@example.test", password: "unused-test-hash", access_level: "administrator" } });
  adminId = admin.id;
  const employee = await db.employees.create({ data: { name: "Funcionário de teste", email: "employee@example.test", phone: "", cel_number: "", cpf: "52998224725", classification: 1, admission: new Date("2020-01-01T00:00:00Z"), salary: 3000 } });
  employeeId = employee.id;
  cora = new FakeCora();
  service = new BankingService(db, cora, () => instant);
  await service.saveAccount(employeeId, { bank_code: "341", branch_number: "0001", account_number: "0123456", account_type: "CHECKING", version: 0 }, adminId);
});
after(async () => { await db.$disconnect(); await prisma.$disconnect(); });

const input = (extra: Record<string, unknown> = {}) => ({ id: randomUUID(), competence: "2026-09", kind: "SALARY",
  payment_date: "2026-09-18", submit_at_local: "2026-09-16T11:00", auto_submit_to_cora: false,
  items: [{ employee_id: employeeId, amount_cents: 250099 }], ...extra });
const create = (extra: Record<string, unknown> = {}) => service.createPayroll(input(extra), adminId);
async function submitted() {
  const run = await create();
  await service.release(run.id, adminId, false, run.version);
  await service.dispatch(run.transfers[0].id);
  return { run, transferId: run.transfers[0].id, remote: cora.remote[0] };
}

test("manual payroll is never sent just because its scheduled time passed", async () => {
  const run = await create();
  await service.tick();
  assert.equal(cora.calls.length, 0);
  assert.equal((await service.payroll(run.id)).transfers[0].status, "DRAFT");
});

test("automatic scheduling and concurrent workers submit exactly once", async () => {
  const run = await create({ auto_submit_to_cora: true });
  await Promise.all([service.tick(), service.tick()]);
  await service.tick();
  assert.equal(cora.calls.length, 1);
  assert.equal(cora.calls[0].payload.scheduled, "2026-09-18");
  assert.equal(cora.calls[0].payload.amount, 250099);
  assert.equal((await service.payroll(run.id)).transfers[0].status, "INITIATED");
  assert.equal(await db.expenses.count(), 0);
});

test("future automatic payroll and disabled processor do not send", async () => {
  await create({ auto_submit_to_cora: true, submit_at_local: "2026-09-17T10:00" });
  await service.tick();
  cora.settings.workerEnabled = false;
  await service.tick();
  assert.equal(cora.calls.length, 0);
});

test("completion and refund create one expense each, including concurrent and out-of-order observations", async () => {
  const { transferId, remote } = await submitted();
  const complete = { ...remote, status: "COMPLETED" };
  await Promise.all([service.applyRemote(transferId, complete), service.applyRemote(transferId, complete)]);
  await service.applyRemote(transferId, remote);
  assert.equal(await db.expenses.count(), 1);
  assert.equal((await db.expenses.findFirst()).amount.toString(), "2500.99");
  assert.equal((await db.bankTransfer.findUnique({ where: { id: transferId } })).status, "COMPLETED");
  await Promise.all([service.applyRemote(transferId, { ...remote, status: "REFUNDED" }), service.applyRemote(transferId, { ...remote, status: "REFUNDED" })]);
  await service.applyRemote(transferId, complete);
  const expenses = await db.expenses.findMany();
  assert.equal(expenses.length, 2);
  assert.equal(expenses.reduce((sum, expense) => sum + Number(expense.amount), 0), 0);
  assert.equal((await db.bankTransfer.findUnique({ where: { id: transferId } })).status, "REFUNDED");
});

test("live Cora responses without document type are accepted and settle one expense", async () => {
  const initiate = cora.initiateTransfer.bind(cora);
  cora.initiateTransfer = async (payload, key) => {
    const remote = await initiate(payload, key);
    delete remote.destination.holder.document.type;
    return remote;
  };
  const { transferId, remote } = await submitted();
  assert.equal((await db.bankTransfer.findUnique({ where: { id: transferId } })).status, "INITIATED");
  await Promise.all([
    service.applyRemote(transferId, { ...remote, status: "COMPLETED" }),
    service.applyRemote(transferId, { ...remote, status: "COMPLETED" })
  ]);
  assert.equal((await db.bankTransfer.findUnique({ where: { id: transferId } })).status, "COMPLETED");
  assert.equal(await db.expenses.count(), 1);
  assert.equal((await db.expenses.findFirst()).amount.toString(), "2500.99");
});

test("sync observes scheduled transfers and the CANCELLED filter supported by live Cora", async () => {
  const { transferId, remote } = await submitted();
  const filters: string[] = [];
  const list = cora.transfers.bind(cora);
  cora.transfers = async (status, start, end, page) => {
    filters.push(status);
    if (status === "CANCELED") throw new Error("Unsupported live filter");
    return list(status, start, end, page);
  };
  remote.status = "SCHEDULED";
  const scheduled = await service.sync((await db.bankTransfer.findUnique({ where: { id: transferId } })).run_id);
  assert.deepEqual(scheduled.warnings, []);
  assert.equal(scheduled.payroll.transfers[0].status, "SCHEDULED");
  remote.status = "CANCELLED";
  const cancelled = await service.sync(scheduled.payroll.id);
  assert.deepEqual(cancelled.warnings, []);
  assert.equal(cancelled.payroll.transfers[0].status, "CANCELLED");
  assert.ok(filters.includes("SCHEDULED"));
  assert.ok(filters.includes("CANCELLED"));
  assert.equal(filters.includes("CANCELED"), false);
  assert.equal(await db.expenses.count(), 0);
});

test("stage completion never enters the real expenses ledger", async () => {
  cora.settings.environment = "STAGE";
  const { remote, transferId } = await submitted();
  await service.applyRemote(transferId, { ...remote, status: "COMPLETED" });
  const transfer = await db.bankTransfer.findUnique({ where: { id: transferId } });
  assert.equal(transfer.status, "COMPLETED");
  assert.ok(transfer.completed_at);
  assert.equal(await db.expenses.count(), 0);
});

test("timeout becomes UNKNOWN; no automatic/manual resubmission or local cancellation is allowed", async () => {
  cora.error = new CoraError(true, false);
  const run = await create({ auto_submit_to_cora: true });
  await service.tick();
  await service.tick();
  const transfer = (await service.payroll(run.id)).transfers[0];
  assert.equal(transfer.status, "UNKNOWN");
  assert.equal(cora.calls.length, 1);
  await assert.rejects(service.transferAction(run.id, transfer.id, "retry", adminId));
  await assert.rejects(service.transferAction(run.id, transfer.id, "cancel", adminId));
  cora.remote.push({ ...cora.calls[0].payload, id: "trn_recovered", status: "COMPLETED" });
  await service.sync(run.id);
  assert.equal((await service.payroll(run.id)).transfers[0].status, "COMPLETED");
  assert.equal(await db.expenses.count(), 1);
});

test("definitive pre-submission failure retries with the identical payload and idempotency key", async () => {
  cora.error = new CoraError(false, true, 401);
  const run = await create();
  await service.release(run.id, adminId, false, run.version);
  await service.dispatch(run.transfers[0].id);
  assert.equal((await service.payroll(run.id)).transfers[0].status, "FAILED");
  cora.error = null;
  await service.transferAction(run.id, run.transfers[0].id, "retry", adminId);
  await service.dispatch(run.transfers[0].id);
  assert.deepEqual(cora.calls[0], cora.calls[1]);
});

test("bank response with wrong amount, payee, reference or account never settles", async () => {
  const { transferId, remote } = await submitted();
  const variants: RemoteTransfer[] = [
    { ...remote, amount: remote.amount + 1 }, { ...remote, code: randomUUID() },
    { ...remote, destination: { ...remote.destination, account_number: "99999" } },
    { ...remote, destination: { ...remote.destination, holder: { ...remote.destination.holder, document: { type: "CPF", identity: "11111111111" } } } }
  ];
  for (const variant of variants) await service.applyRemote(transferId, { ...variant, status: "COMPLETED" });
  assert.equal(await db.expenses.count(), 0);
  assert.equal((await db.bankTransfer.findUnique({ where: { id: transferId } })).status, "UNKNOWN");
});

test("account digits match documented Cora split-digit and empty-digit responses", async () => {
  const { remote } = await submitted();
  const expected = cora.calls[0].payload;
  assert.ok(matchesTransfer(expected, { ...remote, destination: { ...remote.destination, account_number: "012345", account_number_digit: "6" } }));
  assert.ok(matchesTransfer(expected, { ...remote, destination: { ...remote.destination, account_number_digit: "" } }));
  assert.equal(matchesTransfer(expected, { ...remote, destination: { ...remote.destination, bank_code: 341 as unknown as string } }), false);
});

test("changed bank account pauses pending payroll and requires a fresh reviewed snapshot", async () => {
  const run = await create({ auto_submit_to_cora: true });
  await service.saveAccount(employeeId, { bank_code: "341", branch_number: "0001", account_number: "999996", account_type: "CHECKING", version: 1 }, adminId);
  await service.tick();
  const paused = await service.payroll(run.id);
  assert.equal(paused.paused, true);
  assert.equal(cora.calls.length, 0);
  await service.revisePayroll(run.id, input({ id: run.id, version: paused.version }), adminId);
  const revised = await service.payroll(run.id);
  assert.equal(revised.paused, true);
  assert.equal(revised.transfers[0].destination.account_number, "••••9996");
});

test("employee dismissal blocks dispatch even after preparing the payroll", async () => {
  const run = await create({ auto_submit_to_cora: true });
  await db.employees.update({ where: { id: employeeId }, data: { dismissal_date: new Date("2026-09-17T00:00:00Z") } });
  await service.tick();
  assert.equal(cora.calls.length, 0);
  assert.equal((await service.payroll(run.id)).paused, true);
});

test("changing Cora account or environment never dispatches the old account's instructions", async () => {
  const run = await create();
  await service.release(run.id, adminId, false, run.version);
  cora.settings.connectionKey = "other-account";
  await service.dispatch(run.transfers[0].id);
  assert.equal(cora.calls.length, 0);
  await assert.rejects(service.payroll(run.id));
});

test("repeated create reference returns the same payroll; a different body or duplicate month is rejected", async () => {
  const data = input();
  const first = await service.createPayroll(data, adminId);
  const repeat = await service.createPayroll(data, adminId);
  assert.equal(repeat.transfers[0].id, first.transfers[0].id);
  await assert.rejects(service.createPayroll({ ...data, payment_date: "2026-09-19" }, adminId));
  await assert.rejects(create());
  assert.equal(await db.bankPayrollRun.count(), 1);
});

test("duplicate employees, fractional cents and malformed schedules are rejected", async () => {
  await assert.rejects(create({ items: [{ employee_id: employeeId, amount_cents: 100 }, { employee_id: employeeId, amount_cents: 200 }] }));
  await assert.rejects(create({ items: [{ employee_id: employeeId, amount_cents: 100.1 }] }));
  await assert.rejects(create({ payment_date: "2026-02-30" }));
  await assert.rejects(create({ submit_at_local: "2026-09-19T10:00" }));
  assert.equal(saoPauloInstant("2026-09-16T12:00").toISOString(), "2026-09-16T15:00:00.000Z");
});

test("stale configuration, release and revision cannot overwrite a newer review", async () => {
  const data = input();
  const run = await service.createPayroll(data, adminId);
  await service.settings(run.id, { version: run.version, auto_submit_to_cora: false, paused: true }, adminId);
  await assert.rejects(service.release(run.id, adminId, false, run.version));
  await assert.rejects(service.revisePayroll(run.id, { ...data, version: run.version }, adminId));
  await assert.rejects(service.settings(run.id, { version: run.version, auto_submit_to_cora: true, paused: false }, adminId));
});

test("pausing and cancelling before dispatch leave no bank instruction", async () => {
  const run = await create();
  await service.release(run.id, adminId, false, run.version);
  const released = await service.payroll(run.id);
  await service.settings(run.id, { version: released.version, auto_submit_to_cora: false, paused: true }, adminId);
  await service.dispatch(run.transfers[0].id);
  await service.transferAction(run.id, run.transfers[0].id, "cancel", adminId);
  assert.equal(cora.calls.length, 0);
  assert.equal((await service.payroll(run.id)).transfers[0].status, "CANCELLED");
});

test("a stale sending lease is reconciled, never sent again", async () => {
  const run = await create({ auto_submit_to_cora: true });
  await db.bankTransfer.update({ where: { id: run.transfers[0].id }, data: { status: "SUBMITTING", attempts: 1, lease_until: new Date(instant.getTime() - 1) } });
  await service.tick();
  assert.equal(cora.calls.length, 0);
  assert.equal((await service.payroll(run.id)).transfers[0].status, "UNKNOWN");
});

test("forged or duplicated webhooks only trigger authenticated reads and never settle", async () => {
  const { run, remote } = await submitted();
  await service.webhook("evt_fake", remote.id, "transfer.completed");
  await service.webhook("evt_fake", remote.id, "transfer.completed");
  await service.webhook("evt_unknown", "trn_nonexistent", "transfer.completed");
  assert.equal(await db.bankWebhookEvent.count(), 1);
  assert.equal(await db.expenses.count(), 0);
  await service.tick();
  assert.equal((await service.payroll(run.id)).transfers[0].status, "INITIATED");
  assert.equal(await db.expenses.count(), 0);
  assert.equal(await db.bankNotification.count({ where: { status: "COMPLETED" } }), 0);
});

test("confirmed bank updates create one notice per status under concurrent and repeated delivery", async () => {
  const { run, remote, transferId } = await submitted();
  await Promise.all(Array.from({ length: 3 }, () => service.applyRemote(transferId, { ...remote, status: "COMPLETED" })));
  await service.sync(run.id); // Fake bank still says INITIATED: never regress the confirmed payment.
  assert.equal(await db.bankNotification.count({ where: { transfer_id: transferId, status: "COMPLETED" } }), 1);
  assert.equal(await db.expenses.count(), 1);
  const page = await service.notifications.list(adminId, {});
  assert.equal(page.total, 2); // INITIATED and COMPLETED, never the untrusted webhook header.
  assert.equal(page.completed_count, 1);
  assert.equal(page.unread_count, 2);
  assert.equal(JSON.stringify(page).includes("52998224725"), false);
  assert.equal(JSON.stringify(page).includes("0123456"), false);
});

test("webhook stays pending during bank outages and retries without resending the payment", async () => {
  const { remote, run } = await submitted();
  await service.webhook("evt_outage", remote.id, "transfer.completed");
  const list = cora.transfers.bind(cora);
  cora.transfers = async () => { throw new CoraError(false, true, 503); };
  await service.tick();
  assert.equal(await db.bankWebhookEvent.count({ where: { processed_at: null } }), 1);
  assert.equal(await db.bankNotification.count({ where: { status: "COMPLETED" } }), 0);
  assert.equal(await db.expenses.count(), 0);
  cora.transfers = list;
  remote.status = "COMPLETED";
  await service.tick();
  assert.equal((await service.payroll(run.id)).transfers[0].status, "COMPLETED");
  assert.equal(await db.bankWebhookEvent.count({ where: { processed_at: null } }), 0);
  assert.equal(await db.bankNotification.count({ where: { status: "COMPLETED" } }), 1);
  assert.equal(cora.calls.length, 1);
});

test("notification read state belongs to each admin and is isolated by bank connection", async () => {
  await submitted();
  const other = await db.users.create({ data: { name: "Outro admin", email: "other@example.test", password: "unused", access_level: "administrator" } });
  const list = await service.notifications.list(adminId, {});
  await Promise.all([service.notifications.markRead(list.items[0].id, adminId), service.notifications.markRead(list.items[0].id, adminId)]);
  assert.equal((await service.notifications.summary(adminId)).unread_count, 0);
  assert.equal((await service.notifications.summary(other.id)).unread_count, 1);
  assert.equal((await service.notifications.list(adminId, { unread: "true" })).total, 0);
  cora.settings.connectionKey = "another-account";
  assert.equal((await service.notifications.list(adminId, {})).total, 0);
  await assert.rejects(service.notifications.markRead(list.items[0].id, other.id));
  await service.notifications.markAllRead(list.as_of.toISOString(), other.id);
  assert.equal(await db.bankNotificationRead.count({ where: { user_id: other.id } }), 0);
});

test("mark all read preserves notices that arrived after the displayed cutoff", async () => {
  const { remote, transferId } = await submitted();
  const list = await service.notifications.list(adminId, {});
  const later = new BankingService(db, cora, () => new Date(instant.getTime() + 1000));
  await later.applyRemote(transferId, { ...remote, status: "COMPLETED" });
  await later.notifications.markAllRead(list.as_of.toISOString(), adminId);
  const page = await later.notifications.list(adminId, { unread: "true", status: "COMPLETED" });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].status, "COMPLETED");
  await assert.rejects(later.notifications.list(adminId, { page: -1 }));
  await assert.rejects(later.notifications.list(adminId, { page: 1001 }));
  await assert.rejects(later.notifications.list(adminId, { status: "arbitrary" }));
  await assert.rejects(later.notifications.markAllRead("2099-01-01T00:00:00Z", adminId));
});

test("bank-confirmed expense cannot be edited or removed through existing expense service", async () => {
  const { remote, transferId } = await submitted();
  await service.applyRemote(transferId, { ...remote, status: "COMPLETED" });
  const expense = await db.expenses.findFirst();
  await assert.rejects(expenseService.updatePartialExpense(expense.id, { amount: "1.00" }));
  await assert.rejects(expenseService.deleteExpense(expense.id));
});

test("HTTP boundaries reject absent/standard users and old substring-auth bypasses", async () => {
  await db.users.create({ data: { name: "Usuário teste", email: "standard@example.test", password: "unused", access_level: "standard" } });
  const app = express();
  app.use(express.json());
  app.use("/api/v1/banking/webhook", createBankingWebhook(service));
  app.use(AuthenticationHandler);
  app.use("/api/v1/banking", createBankingRouter(service));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api/v1/banking`;
  const token = (email: string) => jwt.sign({ email }, process.env.PRIVATE_KEY, { expiresIn: "1m" });
  try {
    assert.equal((await fetch(`${base}/overview`)).status, 401);
    assert.equal((await fetch(`${base}/overview`, { headers: { Authorization: `Bearer ${token("standard@example.test")}` } })).status, 403);
    assert.equal((await fetch(`${base}/payrolls/login`)).status, 401);
    assert.equal((await fetch(`${base}/payrolls/test`)).status, 401);
    assert.equal((await fetch(`${base}/overview`, { headers: { Authorization: `Bearer ${token("admin@example.test")}` } })).status, 200);
    assert.equal((await fetch(`${base}/notifications`)).status, 401);
    assert.equal((await fetch(`${base}/notifications`, { headers: { Authorization: `Bearer ${token("standard@example.test")}` } })).status, 403);
    assert.equal((await fetch(`${base}/notifications`, { headers: { Authorization: `Bearer ${token("admin@example.test")}` } })).status, 200);
    assert.equal((await fetch(`${base}/notifications/read-all`, { method: "PATCH", headers: {
      Authorization: `Bearer ${token("standard@example.test")}`, "Content-Type": "application/json"
    }, body: JSON.stringify({ before: instant.toISOString() }) })).status, 403);
    assert.equal((await fetch(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 202);
    assert.equal(await db.expenses.count(), 0);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
