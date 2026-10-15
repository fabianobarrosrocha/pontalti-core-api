import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import { PrismaClient } from "@prisma/client";
import prisma from "@pontalti/lib/prisma";
import { HttpCoraGateway } from "@pontalti/integrations/cora/client";
import paymentService from "@pontalti/modules/v1/payments/payment-service";
import customerRepository from "@pontalti/repository/customer";
import orderRepository from "@pontalti/repository/order";
import { CustomerFinanceService } from "./customer-finance-service";
import { createAdminFinanceRouter, createInternalFinanceRouter } from "./routes";

const url = process.env.CUSTOMER_FINANCE_TEST_DATABASE_URL;
if (!url || process.env.DATABASE_URL !== url) throw Error("Use an explicit disposable finance test database.");
const parsed = new URL(url);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/pontalti_customer_finance_test")
  throw Error("Refusing any non-test database.");
const db = new PrismaClient({ datasources: { db: { url } } });
class FakeCora extends HttpCoraGateway {
  env: "PRODUCTION" | "STAGE" = "PRODUCTION";
  connection = "fake-customer-bank";
  entries: any[] = [];
  invoiceCalls = 0;
  invoiceStatus = "OPEN";
  invoicePaid = 0;
  invoice: any;
  failIssue = false;
  context = () => ({
    environment: this.env,
    connectionKey: this.connection,
    configured: true,
    transfersEnabled: false,
    workerEnabled: false
  });
  lastStatementWindow: [string, string] | null = null;
  statement = async (start: string, end: string) => {
    this.lastStatementWindow = [start, end];
    return { entries: this.entries };
  };
  async createCustomerInvoice(payload: any, key: string) {
    this.invoiceCalls++;
    if (this.failIssue) throw Error("Ambiguous timeout");
    this.invoice = {
      id: `inv_${key}`,
      code: payload.code,
      status: "OPEN",
      total_amount: payload.services[0].amount,
      total_paid: 0,
      payment_options: { bank_slip: { url: "https://bank.example.test/invoice.pdf", digitable: "0123456" } }
    };
    return this.invoice;
  }
  customerInvoice = async () => ({ ...this.invoice, status: this.invoiceStatus, total_paid: this.invoicePaid });
}
let cora: FakeCora;
let service: CustomerFinanceService;
let adminId: number;
let productId: number;
let external: string;
let customerId: number;
const doc = "52998224725";
const status = (code: number) => (error: any) => error?.status === code;
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "Customers", "Users", "Adresses", "Products", "Cores", "Espumas", "FinancialAuditEvent", "CustomerFinanceBankEntry" RESTART IDENTITY CASCADE'
  );
  adminId = (
    await db.users.create({
      data: { name: "Admin test", email: "admin@example.test", password: "unused", access_level: "administrator" }
    })
  ).id;
  const color = await db.cores.create({ data: { name: "White", short_code: "WT", status: 1 } });
  const foam = await db.espumas.create({
    data: { name: "Foam", short_code: "FO", size: "M", description: "Test", status: 1 }
  });
  productId = (
    await db.products.create({
      data: {
        sku: "TEST",
        type: "bojo",
        status: 1,
        inner_color_id: color.id,
        outer_color_id: color.id,
        foam_id: foam.id
      }
    })
  ).id;
  cora = new FakeCora();
  service = new CustomerFinanceService(db, cora);
  external = randomUUID();
  const link = await service.link({
    external_customer_id: external,
    name: "New test customer",
    document: doc,
    environment: "PRODUCTION"
  });
  assert.equal(link.status, "APPROVED");
  customerId = link.customer_id;
  process.env.CORA_CUSTOMER_DEPOSITS_ENABLED = "true";
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

async function credit(amount: number, ref = randomUUID()) {
  const claim = await service.createDeposit(
    {
      idempotency_key: randomUUID(),
      external_customer_id: external,
      amount_cents: amount,
      deposited_at: new Date().toISOString(),
      reference: "I deposited money",
      environment: "PRODUCTION"
    },
    "BANK_CLAIM"
  );
  cora.entries = [
    {
      id: ref,
      type: "CREDIT",
      amount,
      createdAt: new Date().toISOString(),
      transaction: {
        id: `trn_${ref}`,
        type: "TRANSFER",
        description: "Transfer from test customer",
        counterParty: { name: "Test Customer", identity: doc }
      }
    }
  ];
  await service.syncBankEntries(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
  const entry = await db.customerFinanceBankEntry.findFirst({ where: { remote_id: ref } });
  await service.reviewDeposit(
    claim.id,
    "confirm",
    { version: claim.version, bank_entry_id: entry.id, reason: "Bank credit and customer identity checked manually" },
    adminId
  );
  return { claim, entry };
}
async function purchase(amount: number, extra: object = {}) {
  const summary = await service.summary(customerId, "PRODUCTION");
  return service.createPurchase({
    idempotency_key: randomUUID(),
    external_customer_id: external,
    external_order_id: randomUUID(),
    amount_cents: amount,
    environment: "PRODUCTION",
    order_snapshot: { items: [{ name: "Product test", product_id: productId, quantity: 1, unit_price_cents: amount }] },
    expected_account_revision: summary.account_revision,
    expected_projected_balance_cents: summary.available_cents - amount,
    ...extra
  });
}
const approve = async (request: any) => {
  const current = await service.purchase(request.id);
  return service.reviewPurchase(
    request.id,
    "approve",
    {
      version: current.version,
      account_revision: current.summary.account_revision,
      reason: "Commercial credit reviewed"
    },
    adminId
  );
};

test("deposit claim never credits without authenticated CREDIT and manual confirmation", async () => {
  const claim = await service.createDeposit(
    {
      idempotency_key: randomUUID(),
      external_customer_id: external,
      amount_cents: 30000,
      deposited_at: new Date().toISOString(),
      environment: "PRODUCTION"
    },
    "BANK_CLAIM"
  );
  assert.equal(claim.status, "PENDING");
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 0);
  await credit(30000);
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 30000);
});
test("bank revalidation searches both adjacent UTC dates around the receipt", async () => {
  const { entry } = await credit(10000);
  const occurredAt = entry.occurred_at.getTime();
  assert.deepEqual(cora.lastStatementWindow, [
    new Date(occurredAt - 86400000).toISOString().slice(0, 10),
    new Date(occurredAt + 86400000).toISOString().slice(0, 10)
  ]);
});
test("one authenticated bank entry cannot credit two claims concurrently", async () => {
  const { entry } = await credit(10000);
  const claim = await service.createDeposit(
    {
      idempotency_key: randomUUID(),
      external_customer_id: external,
      amount_cents: 10000,
      deposited_at: new Date().toISOString(),
      environment: "PRODUCTION"
    },
    "BANK_CLAIM"
  );
  await assert.rejects(
    service.reviewDeposit(
      claim.id,
      "confirm",
      { version: claim.version, bank_entry_id: entry.id, reason: "Attempted reuse" },
      adminId
    ),
    status(409)
  );
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 10000);
});
test("old statement entry absent from the latest authenticated response never credits", async () => {
  const { entry } = await credit(10000);
  await db.customerFinanceDeposit.updateMany({ data: { bank_entry_id: null } });
  const claim = await service.createDeposit(
    {
      idempotency_key: randomUUID(),
      external_customer_id: external,
      amount_cents: 10000,
      deposited_at: new Date().toISOString(),
      environment: "PRODUCTION"
    },
    "BANK_CLAIM"
  );
  cora.entries = [];
  await assert.rejects(
    service.reviewDeposit(
      claim.id,
      "confirm",
      { version: claim.version, bank_entry_id: entry.id, reason: "Old unverified entry" },
      adminId
    ),
    status(409)
  );
});
test("PIX and boleto statement entries cannot double-credit a claim", async () => {
  for (const type of ["PIX", "PAYMENT"]) {
    const claim = await service.createDeposit(
      {
        idempotency_key: randomUUID(),
        external_customer_id: external,
        amount_cents: 10000,
        deposited_at: new Date().toISOString(),
        environment: "PRODUCTION"
      },
      "BANK_CLAIM"
    );
    cora.entries = [
      { id: randomUUID(), type: "CREDIT", amount: 10000, createdAt: new Date().toISOString(), transaction: { type } }
    ];
    await service.syncBankEntries(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
    const entry = await db.customerFinanceBankEntry.findFirst({ where: { remote_id: cora.entries[0].id } });
    await assert.rejects(
      service.reviewDeposit(
        claim.id,
        "confirm",
        { version: claim.version, bank_entry_id: entry.id, reason: "Possible invoice duplicate" },
        adminId
      ),
      status(409)
    );
  }
});
test("funded purchase auto-confirms, retains remaining money, and does not create an extra cash receipt", async () => {
  await credit(30000);
  const row = await purchase(12000);
  assert.equal(row.status, "APPROVED");
  assert.equal(row.cash_applied_cents, 12000);
  assert.equal(row.summary.balance_cents, 18000);
  assert.equal(row.summary.debts_cents, 0);
  assert.equal(await db.payments.count(), 0);
});
test("negative projected balance reserves only positive funds and debt is incurred only on admin approval", async () => {
  await credit(10000);
  const row = await purchase(15000);
  assert.equal(row.status, "PENDING");
  assert.equal(row.reserved_cents, 10000);
  assert.equal(row.summary.balance_cents, 10000);
  assert.equal(row.summary.available_cents, 0);
  assert.equal((await db.customers.findUnique({ where: { id: customerId } })).debts, 0);
  const approved = await approve(row);
  assert.equal(approved.summary.balance_cents, -5000);
  assert.equal(approved.cash_applied_cents, 10000);
  assert.equal((await db.customers.findUnique({ where: { id: customerId } })).debts, 50);
});
test("rejection releases positive hold and never creates debt", async () => {
  await credit(10000);
  const row = await purchase(15000);
  const rejected = await service.reviewPurchase(
    row.id,
    "reject",
    { version: row.version, reason: "Not approved" },
    adminId
  );
  assert.equal(rejected.summary.available_cents, 10000);
  assert.equal(rejected.summary.debts_cents, 0);
});
test("simultaneous purchases cannot both spend the same balance", async () => {
  await credit(10000);
  const preview = await service.summary(customerId, "PRODUCTION");
  const consent = {
    expected_account_revision: preview.account_revision,
    expected_projected_balance_cents: preview.available_cents - 8000
  };
  const results = await Promise.allSettled([purchase(8000, consent), purchase(8000, consent)]);
  assert.equal(
    results.filter((r) => r.status === "fulfilled").length,
    1,
    results.map((r) => (r.status === "rejected" ? r.reason.message : r.value.id)).join(" / ")
  );
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 2000);
});
test("idempotent creation and cancellation return the same operation and refund once", async () => {
  await credit(20000);
  const key = randomUUID(),
    order = randomUUID();
  const row = await purchase(10000, { idempotency_key: key, external_order_id: order });
  const repeat = await purchase(10000, { idempotency_key: key, external_order_id: order });
  assert.equal(repeat.id, row.id);
  assert.equal(repeat.summary.balance_cents, 10000);
  await service.cancelPurchase(row.id, { version: row.version });
  await service.cancelPurchase(row.id, { version: row.version });
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 20000);
  assert.equal(await db.customerFinanceEntry.count({ where: { entry_key: `cancel:${row.id}` } }), 1);
});
test("stale customer consent fails with ACCOUNT_CHANGED and stale admin preview cannot approve", async () => {
  const summary = await service.summary(customerId, "PRODUCTION");
  await credit(10000);
  await assert.rejects(
    purchase(15000, { expected_account_revision: summary.account_revision, expected_projected_balance_cents: -15000 }),
    (error: any) => error.status === 409 && error.code === "ACCOUNT_CHANGED"
  );
  const row = await purchase(15000);
  const preview = row.summary.account_revision;
  await credit(5000);
  await assert.rejects(
    service.reviewPurchase(
      row.id,
      "approve",
      { version: row.version, account_revision: preview, reason: "Stale admin preview" },
      adminId
    ),
    status(409)
  );
  const approved = await approve(row);
  assert.equal(approved.summary.balance_cents, 0);
});
test("reserved balance cannot be consumed by approving a later credit purchase first", async () => {
  await credit(10000);
  const first = await purchase(15000);
  const second = await purchase(2000);
  await assert.rejects(approve(second), status(409));
  await approve(first);
  // The first approval has now worsened the second customer's consent, so a new confirmation is required.
  await assert.rejects(approve(second), status(409));
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, -5000);
});
test("a guessed CPF on a different store UUID creates pending identity and cannot expose money", async () => {
  await credit(50000);
  const impostor = randomUUID();
  const link = await service.link({
    external_customer_id: impostor,
    document: doc,
    name: "Someone else",
    environment: "PRODUCTION"
  });
  assert.equal(link.status, "PENDING");
  assert.equal(link.summary, undefined);
  await assert.rejects(service.externalSummary(impostor, "PRODUCTION"), status(403));
  await assert.rejects(
    service.reviewLink(link.id, "approve", { version: link.version, reason: "Duplicate owner" }, adminId),
    status(409)
  );
});
test("existing legacy customer requires manual identity approval and opens from current debts exactly once", async () => {
  const address = await db.adresses.create({
    data: { zip_code: "", neighborhood: "", public_place: "", city: "", state: "", address_number: 0 }
  });
  const legacy = await db.customers.create({
    data: {
      address_id: address.id,
      status: 1,
      credit_limit: 300,
      debts: 100,
      name: "Legacy",
      store_name: "Legacy",
      deliver: false,
      pontalti: false,
      secondary_line: false,
      cpf: "11144477735",
      updated_at: new Date()
    }
  });
  const id = randomUUID();
  let link = await service.link({
    external_customer_id: id,
    document: "111.444.777-35",
    name: "Legacy",
    environment: "PRODUCTION"
  });
  assert.equal(link.status, "PENDING");
  link = await service.reviewLink(
    link.id,
    "approve",
    { version: link.version, reason: "Identity verified in person" },
    adminId
  );
  assert.equal(link.summary.balance_cents, -10000);
  assert.equal(link.summary.opening_debts_cents, 10000);
  assert.equal(link.summary.legacy_debt_unallocated_cents, 10000);
  const input = {
    idempotency_key: randomUUID(),
    external_customer_id: id,
    external_order_id: randomUUID(),
    environment: "PRODUCTION",
    amount_cents: 1000,
    order_snapshot: { items: [{ name: "One", quantity: 1, product_id: productId, unit_price_cents: 1000 }] },
    expected_account_revision: 0,
    expected_projected_balance_cents: -11000
  };
  const row = await service.createPurchase(input);
  await approve(row);
  assert.equal((await service.summary(legacy.id, "PRODUCTION")).balance_cents, -11000);
  assert.equal(await db.customerFinanceEntry.count({ where: { entry_key: `opening:PRODUCTION:${legacy.id}` } }), 1);
});
test("stage decisions are isolated from production debt and cannot register physical orders", async () => {
  const link = await service.link({
    external_customer_id: external,
    document: doc,
    name: "Stage identity",
    environment: "STAGE"
  });
  await service.reviewLink(link.id, "approve", { version: link.version, reason: "Test identity" }, adminId);
  const row = await purchase(10000, {
    environment: "STAGE",
    expected_account_revision: 0,
    expected_projected_balance_cents: -10000
  });
  const approved = await approve(row);
  assert.equal(approved.summary.balance_cents, -10000);
  assert.equal((await db.customers.findUnique({ where: { id: customerId } })).debts, 0);
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 0);
  await assert.rejects(service.registerOrder(approved.id, { version: approved.version }, adminId), status(409));
  assert.equal(await db.orders.count(), 0);
  await assert.rejects(
    service.createDeposit(
      { idempotency_key: randomUUID(), external_customer_id: external, environment: "STAGE", amount_cents: 1000 },
      "BOLETO"
    ),
    status(409)
  );
});
test("registration is atomic/idempotent and records only funded money, never approved debt as paid", async () => {
  await credit(10000);
  const pending = await purchase(15000);
  const approved = await approve(pending);
  const registered = await service.registerOrder(approved.id, { version: approved.version }, adminId);
  const repeat = await service.registerOrder(approved.id, { version: approved.version }, adminId);
  assert.equal(repeat.core_order_id, registered.core_order_id);
  assert.equal(await db.orders.count(), 1);
  const payments = await db.payments.findMany();
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amount_paid, 100);
  assert.equal(payments[0].remaining, 50);
  await assert.rejects(service.cancelPurchase(approved.id, { version: registered.version }), status(409));
  await assert.rejects(
    orderRepository.updatePartialOrder(registered.core_order_id, { order: { final_price: 1 } }),
    status(409)
  );
  await assert.rejects(paymentService.updatePartialPayment(payments[0].id, { amount_paid: 150 }), status(409));
});
test("later deposit repays approved order debt using the same Payments and debt ledger", async () => {
  const pending = await purchase(15000);
  const approved = await approve(pending);
  const registered = await service.registerOrder(approved.id, { version: approved.version }, adminId);
  assert.equal(await db.payments.count(), 0);
  await credit(10000);
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, -5000);
  const payments = await db.payments.findMany();
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amount_paid, 100);
  assert.equal(payments[0].remaining, 50);
  assert.equal((await service.purchase(registered.id)).cash_applied_cents, 10000);
});
test("legacy payment receipt reduces the same debt, while direct debt edits are blocked", async () => {
  const approved = await approve(await purchase(15000));
  const registered = await service.registerOrder(approved.id, { version: approved.version }, adminId);
  await paymentService.createPayment({
    order_id: registered.core_order_id,
    amount_paid: 50,
    payment_method: "Dinheiro",
    date: new Date()
  } as any);
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, -10000);
  assert.equal((await db.customers.findUnique({ where: { id: customerId } })).debts, 100);
  await assert.rejects(customerRepository.updatePartialCustomer(customerId, { debts: 0 }), status(409));
});
test("legacy unlinked order cannot silently bypass an already managed customer account", async () => {
  await credit(10000);
  const oldOrder = await db.orders.create({ data: { customer_id: customerId, final_price: 100, date: new Date() } });
  await assert.rejects(
    paymentService.createPayment({
      order_id: oldOrder.id,
      amount_paid: 50,
      payment_method: "Cash",
      date: new Date()
    } as any),
    status(409)
  );
  assert.equal(await db.payments.count(), 0);
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 10000);
});
test("legacy payment edit excludes the old payment from remaining calculation", async () => {
  const order = await db.orders.create({ data: { customer_id: customerId, final_price: 100, date: new Date() } });
  const p = await paymentService.createPayment({
    order_id: order.id,
    amount_paid: 30,
    payment_method: "Cash",
    date: new Date()
  } as any);
  const edited = await paymentService.updatePartialPayment(p.id, { amount_paid: 40 });
  assert.equal(edited.remaining, 60);
});
test("boleto credits once only after authenticated exact PAID, ignores partial or forged totals", async () => {
  const deposit = await service.createDeposit(
    { idempotency_key: randomUUID(), external_customer_id: external, amount_cents: 20000, environment: "PRODUCTION" },
    "BOLETO"
  );
  assert.equal(deposit.status, "OPEN");
  assert.equal(cora.invoiceCalls, 1);
  cora.invoiceStatus = "PAID";
  cora.invoicePaid = 19999;
  await service.syncDeposit(deposit.id);
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 0);
  cora.invoicePaid = 20000;
  await Promise.all([service.syncDeposit(deposit.id), service.syncDeposit(deposit.id)]);
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 20000);
  assert.equal(await db.customerFinanceEntry.count({ where: { deposit_id: deposit.id } }), 1);
});
test("ambiguous boleto emission persists UNKNOWN and never automatically sends another request", async () => {
  cora.failIssue = true;
  const input = {
    idempotency_key: randomUUID(),
    external_customer_id: external,
    amount_cents: 10000,
    environment: "PRODUCTION"
  };
  const deposit = await service.createDeposit(input, "BOLETO");
  assert.equal(deposit.status, "UNKNOWN");
  await service.createDeposit(input, "BOLETO");
  assert.equal(cora.invoiceCalls, 1);
});
test("customer can renew consent for a pending order when another approved order changes its projected debt", async () => {
  await credit(10000);
  const first = await purchase(15000);
  const second = await purchase(2000);
  await approve(first);
  await assert.rejects(approve(second), status(409));
  const detail = await service.purchase(second.id);
  const renewed = await service.renewConsent(
    second.id,
    {
      version: detail.version,
      expected_account_revision: detail.summary.account_revision,
      expected_projected_balance_cents: detail.summary.available_cents + detail.reserved_cents - detail.amount_cents
    },
    "PRODUCTION"
  );
  assert.equal(renewed.status, "PENDING");
  assert.equal(renewed.consented_projected_balance_cents, -7000);
  const approved = await approve(renewed);
  assert.equal(approved.summary.balance_cents, -7000);
});
test("concurrent admin decisions approve a request only once", async () => {
  const row = await purchase(15000);
  const input = { version: row.version, account_revision: row.summary.account_revision, reason: "Parallel review" };
  const results = await Promise.allSettled([
    service.reviewPurchase(row.id, "approve", input, adminId),
    service.reviewPurchase(row.id, "approve", input, adminId)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, -15000);
  assert.equal(await db.customerFinanceEntry.count({ where: { purchase_id: row.id, kind: "PURCHASE" } }), 1);
});
test("concurrent manual matches credit exactly one of two deposit claims", async () => {
  const claims = await Promise.all(
    [0, 1].map(() =>
      service.createDeposit(
        {
          idempotency_key: randomUUID(),
          external_customer_id: external,
          amount_cents: 10000,
          deposited_at: new Date().toISOString(),
          environment: "PRODUCTION"
        },
        "BANK_CLAIM"
      )
    )
  );
  cora.entries = [
    {
      id: randomUUID(),
      type: "CREDIT",
      amount: 10000,
      createdAt: new Date().toISOString(),
      transaction: { type: "TRANSFER" }
    }
  ];
  await service.syncBankEntries(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
  const entry = await db.customerFinanceBankEntry.findFirst({ where: { remote_id: cora.entries[0].id } });
  const results = await Promise.allSettled(
    claims.map((claim) =>
      service.reviewDeposit(
        claim.id,
        "confirm",
        { version: claim.version, bank_entry_id: entry.id, reason: "Manually matched bank transaction" },
        adminId
      )
    )
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 10000);
});
test("credential rotation cannot credit the same bank remote ID twice", async () => {
  const first = await credit(10000);
  cora.connection = "rotated-customer-bank";
  const claim = await service.createDeposit(
    {
      idempotency_key: randomUUID(),
      external_customer_id: external,
      amount_cents: 10000,
      deposited_at: new Date().toISOString(),
      environment: "PRODUCTION"
    },
    "BANK_CLAIM"
  );
  await service.syncBankEntries(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
  const rotated = await db.customerFinanceBankEntry.findFirst({
    where: { connection_key: cora.connection, remote_id: first.entry.remote_id }
  });
  await assert.rejects(
    service.reviewDeposit(
      claim.id,
      "confirm",
      { version: claim.version, bank_entry_id: rotated.id, reason: "Credential rotation test" },
      adminId
    ),
    status(409)
  );
  assert.equal((await service.summary(customerId, "PRODUCTION")).balance_cents, 10000);
});
test("changed counterparty metadata blocks credit until bank reconciliation is reviewed", async () => {
  await credit(10000);
  cora.entries[0].transaction.counterParty.identity = "11144477735";
  await assert.rejects(
    service.syncBankEntries(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)),
    status(502)
  );
});
test("approved order completes only an empty customer address from the immutable checkout snapshot", async () => {
  const row = await purchase(10000, {
    order_snapshot: {
      items: [{ name: "Product", quantity: 1, product_id: productId, unit_price_cents: 10000 }],
      shipping_cents: 0,
      discount_cents: 0,
      delivery: "Delivery",
      notes: "Call on arrival",
      address: {
        zip_code: "01001000",
        public_place: "Square test",
        neighborhood: "Center",
        city: "São Paulo",
        state: "SP",
        address_number: "42",
        complement: null
      }
    }
  });
  const approved = await approve(row);
  await service.registerOrder(approved.id, { version: approved.version }, adminId);
  const customer = await db.customers.findUnique({ where: { id: customerId }, include: { address: true } });
  assert.equal(customer.address.public_place, "Square test");
  assert.equal(customer.address.address_number, 42);
  assert.equal((await service.purchase(row.id)).order_snapshot["notes"], "Call on arrival");
});
test("router authentication denies unauthenticated internal calls and standard-role administration", async () => {
  process.env.CUSTOMER_FINANCE_INTERNAL_TOKEN = "finance-test-only-secret-32-characters-long";
  const app = express();
  app.use(express.json());
  app.use("/internal", createInternalFinanceRouter(service));
  app.use(
    "/admin",
    (req, _res, next) => {
      (req as any).user = { id: adminId, access_level: "standard" };
      next();
    },
    createAdminFinanceRouter(service)
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as any).port;
  try {
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/internal/customers/${external}/summary?environment=PRODUCTION`)).status,
      401
    );
    assert.equal((await fetch(`http://127.0.0.1:${port}/admin/approvals`)).status, 403);
    const result = await fetch(
      `http://127.0.0.1:${port}/internal/customers/${external}/summary?environment=PRODUCTION`,
      { headers: { Authorization: `Bearer ${process.env.CUSTOMER_FINANCE_INTERNAL_TOKEN}` } }
    );
    assert.equal(result.status, 200);
    assert.equal(((await result.json()) as any).balance_cents, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
