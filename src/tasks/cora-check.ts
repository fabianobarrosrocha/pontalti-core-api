import "dotenv/config";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { CoraError, HttpCoraGateway } from "@pontalti/integrations/cora/client";
import { dateInSaoPaulo } from "@pontalti/modules/v1/banking/banking-domain";

type Check = { name: string; ok: boolean; details?: unknown; message?: string; http_status?: number };
const financialTables = ["BankEmployeeAccount", "BankPayrollRun", "BankTransfer", "FinancialAuditEvent", "BankWebhookEvent",
  "BankNotification", "BankNotificationRead"];

async function main() {
  const gateway = new HttpCoraGateway();
  const { connectionKey, ...context } = gateway.context();
  const checks: Check[] = [];
  const db = new PrismaClient();

  try {
    if (!context.configured) {
      checks.push({ name: "credentials", ok: false,
        message: "Preencha CORA_CLIENT_ID e os arquivos CORA_CERT_PATH/CORA_KEY_PATH no .env da API." });
    } else {
      let certificateValid = false;
      try {
        const certificate = new X509Certificate(process.env.CORA_CERT_PEM || readFileSync(process.env.CORA_CERT_PATH!, "utf8"));
        const key = createPrivateKey(process.env.CORA_KEY_PEM || readFileSync(process.env.CORA_KEY_PATH!, "utf8"));
        certificateValid = certificate.checkPrivateKey(key) &&
          Date.parse(certificate.validFrom) <= Date.now() && Date.parse(certificate.validTo) > Date.now();
        checks.push({ name: "certificate", ok: certificateValid, details: { valid_until: certificate.validTo },
          ...(certificateValid ? {} : { message: "Confira a validade do certificado e a correspondência com a chave." }) });
      } catch {
        checks.push({ name: "certificate", ok: false, message: "Não foi possível ler o certificado e a chave mTLS." });
      }

      if (certificateValid) {
        const today = dateInSaoPaulo();
        const start = dateInSaoPaulo(new Date(Date.now() - 86400000));
        const requests: [string, () => Promise<unknown>][] = [
          ["account", () => gateway.account()],
          ["balance", async () => ({ balance_cents: await gateway.balance() })],
          ["banks", () => gateway.banks()],
          ["statement", () => gateway.statement(start, today, 1)],
          ["transfers", () => gateway.transfers("INITIATED", start, today, 0)]
        ];
        for (const [name, request] of requests) {
          try {
            const value = await request();
            checks.push({ name, ok: true, details: name === "balance" ? value : {
              fields: value && typeof value === "object" ? Object.keys(value) : []
            } });
          } catch (error) {
            checks.push({ name, ok: false, message: "A consulta autenticada à Cora falhou. Confira ambiente, credenciais e conectividade.",
              ...(error instanceof CoraError ? { http_status: error.httpStatus } : {}) });
          }
        }
      }
    }

    try {
      const tables = await db.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('BankEmployeeAccount', 'BankPayrollRun', 'BankTransfer', 'FinancialAuditEvent', 'BankWebhookEvent',
            'BankNotification', 'BankNotificationRead')
      `;
      const missing = financialTables.filter((name) => !tables.some((table) => table.table_name === name));
      checks.push({ name: "database", ok: missing.length === 0, details: { missing_tables: missing },
        ...(missing.length ? { message: "Aplique a migration bancária na base selecionada antes de usar a folha." } : {}) });
    } catch {
      checks.push({ name: "database", ok: false, message: "A conexão com PostgreSQL falhou. Confira DATABASE_URL e o serviço do banco." });
    }

    console.log(JSON.stringify({ checked_at: new Date().toISOString(), read_only: true, context, checks }, null, 2));
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error("Não foi possível verificar a configuração Cora. Confira CORA_ENV e as variáveis da API.");
  process.exitCode = 1;
});
