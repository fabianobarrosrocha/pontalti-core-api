import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { CoraError, HttpCoraGateway } from "./client";
import { TransferPayload } from "@pontalti/modules/v1/banking/banking-domain";

const variables = ["CORA_ENV", "CORA_CLIENT_ID", "CORA_CERT_PEM", "CORA_KEY_PEM"];
const saved = Object.fromEntries(variables.map((key) => [key, process.env[key]]));
beforeEach(() => {
  process.env.CORA_ENV = "stage";
  process.env.CORA_CLIENT_ID = "fake-client-id";
  process.env.CORA_CERT_PEM = "fake-certificate-for-intercepted-requests";
  process.env.CORA_KEY_PEM = "fake-private-key-for-intercepted-requests";
});
afterEach(() => variables.forEach((key) => {
  if (saved[key] === undefined) delete process.env[key];
  else process.env[key] = saved[key];
}));

const payload: TransferPayload = { code: "00000000-0000-4000-8000-000000000001", amount: 123456,
  scheduled: "2026-09-18", category: "PAYROLL", description: "Salário 2026-09",
  destination: { bank_code: "341", branch_number: "0001", account_number: "1234567", account_type: "CHECKING",
    holder: { name: "Funcionário teste", document: { identity: "52998224725", type: "CPF" } } } };
type Captured = { hostname: string; path: string; method: string; cert: string; key: string; headers: Record<string, string>; body: string };
type TestContext = Parameters<NonNullable<Parameters<typeof test>[0]>>[0];

// Intercept https.request entirely: tests cannot connect to Cora or send money.
function intercept(t: TestContext, reply: (call: Captured) => { status: number; body: unknown } | "timeout") {
  const calls: Captured[] = [];
  const replacement = (options, callback) => {
    const call: Captured = { ...options, body: "" };
    calls.push(call);
    const req = new EventEmitter() as EventEmitter & { write: (value: string) => void; end: () => void; destroy: () => void };
    req.write = (value) => { call.body += value; };
    req.destroy = () => { req.emit("error", new Error("Simulated connection loss")); };
    req.end = () => queueMicrotask(() => {
      const result = reply(call);
      if (result === "timeout") { req.emit("timeout"); return; }
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = result.status;
      callback(res);
      res.emit("data", Buffer.from(JSON.stringify(result.body)));
      res.emit("end");
    });
    return req;
  };
  t.mock.method(https, "request", replacement as typeof https.request);
  return calls;
}

test("Cora adapter uses mTLS, token cache and persisted idempotency key with integer cents", async (t) => {
  const calls = intercept(t, (call) => call.path === "/token"
    ? { status: 200, body: { access_token: "fake-access-token", expires_in: 3600 } }
    : { status: 200, body: { ...payload, id: "trn_test", status: "INITIATED" } });
  const client = new HttpCoraGateway();
  await client.initiateTransfer(payload, payload.code);
  await client.initiateTransfer(payload, payload.code);
  assert.equal(calls.filter((call) => call.path === "/token").length, 1);
  assert.ok(calls.every((call) => call.hostname === "matls-clients.api.stage.cora.com.br" && call.cert && call.key));
  assert.equal(calls[0].body, "grant_type=client_credentials&client_id=fake-client-id");
  assert.equal(calls[1].path, "/transfers/initiate");
  assert.equal(calls[1].headers["Idempotency-Key"], payload.code);
  assert.equal(calls[1].headers.Authorization, "Bearer fake-access-token");
  assert.deepEqual(JSON.parse(calls[1].body), payload);
});

test("Cora timeout and HTTP conflict are ambiguous, while a business rejection is definitive", async (t) => {
  let response: "timeout" | number = "timeout";
  intercept(t, (call) => call.path === "/token"
    ? { status: 200, body: { access_token: "fake-access-token" } }
    : response === "timeout" ? "timeout" : { status: response, body: { private_bank_message: "must not escape" } });
  const client = new HttpCoraGateway();
  for (const status of ["timeout", 408, 409, 500, 400] as const) {
    response = status;
    await assert.rejects(client.initiateTransfer(payload, payload.code), (error: CoraError) => {
      assert.equal(error.uncertain, status !== 400);
      assert.equal(error.message.includes("must not escape"), false);
      return true;
    });
  }
});

test("balance cents accept integer numbers/strings and reject ambiguous decimal units", async (t) => {
  let balance: number | string = 10001;
  intercept(t, (call) => call.path === "/token"
    ? { status: 200, body: { access_token: "fake-access-token" } }
    : { status: 200, body: { balance } });
  const client = new HttpCoraGateway();
  assert.equal(await client.balance(), 10001);
  balance = "10001";
  assert.equal(await client.balance(), 10001);
  balance = "100.01";
  await assert.rejects(client.balance());
});

test("transfer pagination follows the documented query and refuses malformed responses", async (t) => {
  let valid = true;
  const calls = intercept(t, (call) => call.path === "/token"
    ? { status: 200, body: { access_token: "fake-access-token" } }
    : { status: 200, body: valid ? { content: [], hasMore: false } : { content: [] } });
  const client = new HttpCoraGateway();
  await client.transfers("COMPLETED", "2026-09-01", "2026-09-16", 0);
  assert.equal(calls[1].path, "/transfer/third-party/transfers/?status=COMPLETED&start=2026-09-01&end=2026-09-16&page=0&size=100");
  valid = false;
  await assert.rejects(client.transfers("COMPLETED", "2026-09-01", "2026-09-16", 1));
});

test("webhook adapter lists and registers transfer events with mTLS and a stable key", async (t) => {
  const endpoint = { id: "end_test", url: "https://api.example.com/hook", resource: "transfer", trigger: "*", active: true };
  const calls = intercept(t, (call) => call.path === "/token"
    ? { status: 200, body: { access_token: "fake-access-token" } }
    : { status: 200, body: call.method === "GET" ? [endpoint] : endpoint });
  const client = new HttpCoraGateway();
  assert.deepEqual(await client.webhookEndpoints(), [endpoint]);
  await client.createTransferWebhook(endpoint.url, payload.code);
  assert.equal(calls[1].path, "/endpoints/");
  assert.equal(calls[1].method, "GET");
  assert.equal(calls[2].method, "POST");
  assert.equal(calls[2].headers["Idempotency-Key"], payload.code);
  assert.deepEqual(JSON.parse(calls[2].body), { url: endpoint.url, resource: "transfer", trigger: "*" });
  assert.ok(calls.every((call) => call.hostname === "matls-clients.api.stage.cora.com.br" && call.cert && call.key));
});
