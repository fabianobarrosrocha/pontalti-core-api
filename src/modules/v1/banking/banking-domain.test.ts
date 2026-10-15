import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesTransfer, RemoteTransfer, TransferPayload } from "./banking-domain";

const expected: TransferPayload = {
  code: "00000000-0000-4000-8000-000000000001", amount: 1000, category: "PAYROLL",
  description: "Salário de teste", scheduled: "2026-10-14",
  destination: {
    bank_code: "341", branch_number: "0001", account_number: "1234567", account_type: "CHECKING",
    holder: { name: "Favorecido de teste", document: { identity: "52998224725", type: "CPF" } }
  }
};

const remote: RemoteTransfer = {
  id: "trn_test", status: "INITIATED", code: expected.code, amount: expected.amount,
  description: expected.description, category: expected.category,
  destination: {
    ...expected.destination, account_number: "123456", account_number_digit: "7",
    holder: { name: expected.destination.holder.name, document: { identity: "52998224725" } }
  }
};

test("matches the live Cora response with split account digit and omitted optional CPF type/date", () => {
  assert.equal(matchesTransfer(expected, remote), true);
});

test("infers CNPJ only from the full matching 14-digit document", () => {
  const company = { ...expected, destination: { ...expected.destination,
    holder: { name: "Empresa de teste", document: { identity: "11222333000181", type: "CNPJ" as const } } } };
  const companyRemote = { ...remote, destination: { ...remote.destination,
    holder: { name: "Empresa de teste", document: { identity: "11222333000181" } } } };
  assert.equal(matchesTransfer(company, companyRemote), true);
});

test("omitted document type never permits another, masked or malformed document", () => {
  for (const identity of ["11144477735", "***982247**", "5299822472", "529.982.247-25", ""]) {
    assert.equal(matchesTransfer(expected, { ...remote, destination: { ...remote.destination,
      holder: { ...remote.destination.holder, document: { identity } } } }), false);
  }
  assert.equal(matchesTransfer(expected, { ...remote, destination: { ...remote.destination,
    holder: { ...remote.destination.holder, document: { identity: "52998224725", type: "CNPJ" } } } }), false);
});

test("missing optional CPF type still rejects a different amount, reference, bank, account or date", () => {
  const variants: RemoteTransfer[] = [
    { ...remote, amount: 1001 }, { ...remote, code: "another-reference" },
    { ...remote, destination: { ...remote.destination, bank_code: "260" } },
    { ...remote, destination: { ...remote.destination, branch_number: "0002" } },
    { ...remote, destination: { ...remote.destination, account_number_digit: "8" } },
    { ...remote, destination: { ...remote.destination, account_type: "SAVINGS" } },
    { ...remote, scheduled: "2026-10-15" }
  ];
  for (const variant of variants) assert.equal(matchesTransfer(expected, variant), false);
  assert.equal(matchesTransfer(expected, remote, "trn_another"), false);
});
