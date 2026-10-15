import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { HttpCoraGateway } from "@pontalti/integrations/cora/client";
import { BankingService } from "./banking-service";

function serviceFor(response: unknown) {
  const gateway = new HttpCoraGateway();
  gateway.statement = async () => response;
  return new BankingService({} as PrismaClient, gateway);
}

test("empty Cora statement with null entries becomes an empty list", async () => {
  const response = { entries: null, start: { balance: 18320 }, end: { balance: 18320 } };
  const result = await serviceFor(response).statement("2026-09-01", "2026-09-29", 1);
  assert.deepEqual(result, { ...response, entries: [], page: 1, has_more: false });
});

test("statement preserves bank entries and indicates a full page", async () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({ id: String(index), amount: index + 1 }));
  const result = await serviceFor({ entries }).statement("2026-09-01", "2026-09-29", 2);
  assert.deepEqual(result.entries, entries);
  assert.equal(result.page, 2);
  assert.equal(result.has_more, true);
});

test("malformed statement entries still fail instead of appearing empty", async () => {
  for (const response of [null, {}, { entries: {} }, { entries: "invalid" }]) {
    await assert.rejects(serviceFor(response).statement("2026-09-01", "2026-09-29", 1),
      (error: { status?: number }) => error.status === 502);
  }
});
