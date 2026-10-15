import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:https";
import createError from "http-errors";
import { BankEnvironment } from "@prisma/client";
import { RemoteTransfer, TransferPayload } from "@pontalti/modules/v1/banking/banking-domain";

export type BankingContext = {
  environment: BankEnvironment;
  connectionKey: string;
  configured: boolean;
  transfersEnabled: boolean;
  workerEnabled: boolean;
};

export type CoraWebhookEndpoint = {
  id: string;
  url: string;
  resource: string;
  trigger: string;
  active: boolean;
};

export interface CoraGateway {
  context(): BankingContext;
  account(): Promise<unknown>;
  balance(): Promise<number>;
  banks(): Promise<unknown>;
  statement(start: string, end: string, page: number): Promise<unknown>;
  initiateTransfer(payload: TransferPayload, key: string): Promise<RemoteTransfer>;
  transfers(status: string, start: string, end: string, page: number): Promise<{ content: RemoteTransfer[]; hasMore: boolean }>;
}

export class CoraError extends Error {
  constructor(public readonly uncertain: boolean, public readonly retryable: boolean, public readonly httpStatus?: number) {
    super(uncertain ? "Resultado do envio desconhecido. Consulte o banco antes de qualquer nova instrução."
      : retryable ? "Cora indisponível para envio. A instrução pode ser tentada novamente."
      : "A Cora recusou a instrução. Confira os dados e as condições da conta.");
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function getBankingContext(): BankingContext {
  const environment = (process.env.CORA_ENV ?? "stage").toUpperCase();
  if (environment !== "STAGE" && environment !== "PRODUCTION") {
    throw createError(503, "CORA_ENV deve ser stage ou production.");
  }
  const clientId = process.env.CORA_CLIENT_ID?.trim();
  const cert = !!process.env.CORA_CERT_PEM || !!(process.env.CORA_CERT_PATH && existsSync(process.env.CORA_CERT_PATH));
  const key = !!process.env.CORA_KEY_PEM || !!(process.env.CORA_KEY_PATH && existsSync(process.env.CORA_KEY_PATH));
  return {
    environment, connectionKey: createHash("sha256").update(`${environment}:${clientId ?? "unconfigured"}`).digest("hex"),
    configured: !!clientId && cert && key,
    transfersEnabled: process.env.CORA_TRANSFERS_ENABLED === "true",
    workerEnabled: process.env.CORA_PAYROLL_WORKER_ENABLED === "true"
  };
}

export type CoraCustomerInvoice = {
  id: string; code: string; status: string; total_amount: number; total_paid: number;
  payment_options?: { bank_slip?: { url?: string; digitable?: string } };
};

export class HttpCoraGateway implements CoraGateway {
  private cachedToken?: { value: string; until: number; connection: string };
  private pendingToken?: Promise<string>;
  context = getBankingContext;

  private async http(method: string, path: string, body?: string, token?: string, key?: string): Promise<unknown> {
    const context = this.context();
    if (!context.configured) throw new CoraError(false, true);
    const cert = process.env.CORA_CERT_PEM || readFileSync(process.env.CORA_CERT_PATH!, "utf8");
    const privateKey = process.env.CORA_KEY_PEM || readFileSync(process.env.CORA_KEY_PATH!, "utf8");
    const host = context.environment === "STAGE" ? "matls-clients.api.stage.cora.com.br" : "matls-clients.api.cora.com.br";
    const mutation = method === "POST" && path !== "/token";
    return new Promise((resolve, reject) => {
      const req = request({ hostname: host, path, method, cert, key: privateKey, timeout: 25000,
        headers: {
          "Content-Type": path === "/token" ? "application/x-www-form-urlencoded" : "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
          ...(body ? { "Content-Length": Buffer.byteLength(body).toString() } : {})
        }
      }, (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 5_000_000) req.destroy(new Error("Response too large"));
          else chunks.push(chunk);
        });
        res.on("error", () => reject(new CoraError(mutation, !mutation)));
        res.on("end", () => {
          const status = res.statusCode ?? 500;
          if (status < 200 || status >= 300) {
            if (status === 401) this.cachedToken = undefined;
            const uncertain = mutation && ![400, 401, 403, 404, 422, 429].includes(status);
            return reject(new CoraError(uncertain, [401, 403, 429].includes(status) || !mutation, status));
          }
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { reject(new CoraError(mutation, !mutation)); }
        });
      });
      req.on("error", () => reject(new CoraError(mutation, !mutation)));
      req.on("timeout", () => req.destroy(new Error("Timeout")));
      if (body) req.write(body);
      req.end();
    });
  }

  private async token(): Promise<string> {
    const context = this.context();
    if (this.cachedToken?.connection === context.connectionKey && this.cachedToken.until > Date.now()) return this.cachedToken.value;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = (async () => {
      const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.CORA_CLIENT_ID ?? "" });
      const result = await this.http("POST", "/token", body.toString()) as { access_token?: string; expires_in?: number };
      if (typeof result?.access_token !== "string") throw new CoraError(false, true);
      this.cachedToken = { value: result.access_token, until: Date.now() + (Number(result.expires_in ?? 3600) - 60) * 1000, connection: context.connectionKey };
      return result.access_token;
    })();
    try { return await this.pendingToken; } finally { this.pendingToken = undefined; }
  }

  private async get(path: string) { return this.http("GET", path, undefined, await this.token()); }
  account() { return this.get("/third-party/account/"); }
  banks() { return this.get("/banks"); }

  async webhookEndpoints(): Promise<CoraWebhookEndpoint[]> {
    const result = await this.get("/endpoints/");
    if (!Array.isArray(result) || result.some((entry) => !entry ||
      ![entry.id, entry.url, entry.resource, entry.trigger].every((value) => typeof value === "string") ||
      typeof entry.active !== "boolean")) throw createError(502, "Lista de webhooks Cora em formato não reconhecido.");
    return result;
  }

  async createTransferWebhook(url: string, idempotencyKey: string): Promise<unknown> {
    return this.http("POST", "/endpoints/", JSON.stringify({ url, resource: "transfer", trigger: "*" }),
      await this.token(), idempotencyKey);
  }

  async balance(): Promise<number> {
    const result = await this.get("/third-party/account/balance") as { balance: unknown };
    // OpenAPI's example is integer cents. Decimal strings are rejected rather than guessed.
    const value = result?.balance;
    if ((typeof value !== "number" && !(typeof value === "string" && /^-?\d+$/.test(value))) || !Number.isSafeInteger(Number(value))) {
      throw createError(502, "Formato de saldo Cora não reconhecido.");
    }
    return Number(value);
  }

  statement(start: string, end: string, page: number) {
    return this.get(`/bank-statement/statement?${new URLSearchParams({ start, end, page: String(page), perPage: "100" })}`);
  }

  async createCustomerInvoice(payload: unknown, key: string): Promise<CoraCustomerInvoice> {
    const result = await this.http("POST", "/v2/invoices/", JSON.stringify(payload), await this.token(), key) as CoraCustomerInvoice;
    if (typeof result?.id !== "string" || typeof result?.status !== "string" || !Number.isSafeInteger(result?.total_amount)) {
      throw new CoraError(true, false);
    }
    return result;
  }

  async customerInvoice(id: string): Promise<CoraCustomerInvoice> {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw createError(400, "Identificador de cobrança inválido.");
    const result = await this.get(`/v2/invoices/${encodeURIComponent(id)}`) as CoraCustomerInvoice;
    if (typeof result?.id !== "string" || typeof result?.status !== "string" || !Number.isSafeInteger(result?.total_amount)) {
      throw new CoraError(false, true);
    }
    return result;
  }

  async initiateTransfer(payload: TransferPayload, key: string): Promise<RemoteTransfer> {
    const token = await this.token();
    const result = await this.http("POST", "/transfers/initiate", JSON.stringify(payload), token, key) as RemoteTransfer;
    if (typeof result?.id !== "string" || typeof result?.status !== "string") throw new CoraError(true, false);
    return result;
  }

  async transfers(status: string, start: string, end: string, page: number) {
    const query = new URLSearchParams({ status, start, end, page: String(page), size: "100" });
    const result = await this.get(`/transfer/third-party/transfers/?${query}`) as { content: RemoteTransfer[]; hasMore: boolean };
    if (!Array.isArray(result?.content) || typeof result.hasMore !== "boolean") {
      throw createError(502, "Formato de transferências Cora não reconhecido.");
    }
    return result;
  }
}
