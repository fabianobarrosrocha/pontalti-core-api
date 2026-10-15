import { test } from "node:test";
import assert from "node:assert/strict";
import { CoraWebhookEndpoint } from "./client";
import { ensureTransferWebhook, TransferWebhookGateway, validateWebhookUrl } from "./webhooks";

function fakeGateway() {
  const entries: CoraWebhookEndpoint[] = [];
  const calls: { url: string; key: string }[] = [];
  const gateway: TransferWebhookGateway = {
    context: () => ({ connectionKey: "account-stage", configured: true }),
    webhookEndpoints: async () => entries,
    createTransferWebhook: async (url, key) => {
      calls.push({ url, key });
      entries.push({ id: "endpoint_test", url, resource: "transfer", trigger: "*", active: true });
    }
  };
  return { gateway, entries, calls };
}

test("webhook registration reuses an existing subscription and preserves other endpoints", async () => {
  const { gateway, entries, calls } = fakeGateway();
  entries.push({ id: "unrelated", url: "https://other.example.com/hook", resource: "invoice", trigger: "paid", active: true });
  const first = await ensureTransferWebhook(gateway, "https://api.example.com/api/v1/banking/webhook");
  const second = await ensureTransferWebhook(gateway, "https://api.example.com/api/v1/banking/webhook");
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(calls.length, 1);
  assert.equal(entries.length, 2);
  assert.match(calls[0].key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("uncertain webhook registration can be recovered by listing, without a second POST", async () => {
  const { gateway, calls } = fakeGateway();
  const create = gateway.createTransferWebhook;
  gateway.createTransferWebhook = async (url, key) => { await create(url, key); throw new Error("Timeout after acceptance"); };
  await assert.rejects(ensureTransferWebhook(gateway, "https://api.example.com/hook"));
  const recovered = await ensureTransferWebhook(gateway, "https://api.example.com/hook");
  assert.equal(recovered.created, false);
  assert.equal(calls.length, 1);
});

test("registration key remains stable across runs and separate across accounts", async () => {
  const first = fakeGateway();
  const retry = fakeGateway();
  const other = fakeGateway();
  other.gateway.context = () => ({ connectionKey: "other-production-account", configured: true });
  for (const context of [first, retry, other]) await ensureTransferWebhook(context.gateway, "https://api.example.com/hook");
  assert.equal(first.calls[0].key, retry.calls[0].key);
  assert.notEqual(first.calls[0].key, other.calls[0].key);
});

test("local, insecure or credential-bearing callback URLs are rejected before bank requests", async () => {
  const { gateway, calls } = fakeGateway();
  for (const url of ["", "http://api.example.com/hook", "https://localhost/hook", "https://127.0.0.1/hook",
    "https://[::1]/hook", "https://factory.local/hook", "https://user:secret@api.example.com/hook",
    "https://api.example.com/hook?token=secret", "https://api.example.com/hook#fragment"]) {
    await assert.rejects(ensureTransferWebhook(gateway, url));
  }
  assert.equal(calls.length, 0);
  assert.equal(validateWebhookUrl("https://api.example.com/hook"), "https://api.example.com/hook");
});
