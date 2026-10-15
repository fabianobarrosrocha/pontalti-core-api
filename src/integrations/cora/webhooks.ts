import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { CoraWebhookEndpoint } from "./client";

export interface TransferWebhookGateway {
  context(): { connectionKey: string; configured: boolean };
  webhookEndpoints(): Promise<CoraWebhookEndpoint[]>;
  createTransferWebhook(url: string, idempotencyKey: string): Promise<unknown>;
}

export function validateWebhookUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Informe uma URL HTTPS pública para receber os avisos da Cora."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    (url.port && url.port !== "443") || isIP(url.hostname) || url.hostname.includes(":") ||
    !url.hostname.includes(".") || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)) {
    throw new Error("Use uma URL HTTPS pública, sem credenciais, parâmetros ou fragmentos.");
  }
  return url.toString();
}

export async function ensureTransferWebhook(gateway: TransferWebhookGateway, value: string) {
  const url = validateWebhookUrl(value);
  const context = gateway.context();
  if (!context.configured) throw new Error("Configure a conexão Cora antes de cadastrar o webhook.");
  const matches = (entry: CoraWebhookEndpoint) => entry.active && entry.url === url &&
    entry.resource === "transfer" && entry.trigger === "*";
  const existing = (await gateway.webhookEndpoints()).find(matches);
  if (existing) return { created: false, endpoint: existing };
  // Stable across process restarts; list before POST also prevents duplicates after uncertain responses.
  const hash = createHash("sha256").update(`${context.connectionKey}:transfer:*:${url}`).digest("hex");
  const key = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  await gateway.createTransferWebhook(url, key);
  const endpoint = (await gateway.webhookEndpoints()).find(matches);
  if (!endpoint) throw new Error("A Cora ainda não confirmou o cadastro ativo. Consulte os endpoints antes de repetir.");
  return { created: true, endpoint };
}
