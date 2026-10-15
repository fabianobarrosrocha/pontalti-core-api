import "dotenv/config";
import { randomUUID } from "node:crypto";
import { HttpCoraGateway } from "@pontalti/integrations/cora/client";
import { ensureTransferWebhook, validateWebhookUrl } from "@pontalti/integrations/cora/webhooks";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg, index) => arg !== "--check" && arg !== "--url" && args[index - 1] !== "--url")) {
    throw new Error("Use cora:webhook -- --check ou cora:webhook -- --url https://sua-api/api/v1/banking/webhook.");
  }
  const gateway = new HttpCoraGateway();
  const { connectionKey, ...context } = gateway.context();
  if (args.includes("--check")) {
    const endpoints = await gateway.webhookEndpoints();
    console.log(JSON.stringify({ context, transfer_webhooks: endpoints.filter((e) => e.resource === "transfer")
      .map(({ url, id, trigger, active }) => ({ id, trigger, active, host: new URL(url).host })) }, null, 2));
    return;
  }
  const urlIndex = args.indexOf("--url");
  const url = args[urlIndex + 1] && urlIndex >= 0 ? args[urlIndex + 1] : process.env.CORA_WEBHOOK_URL;
  if (!url) throw new Error("O sistema está local. Informe uma URL HTTPS pública em CORA_WEBHOOK_URL ou --url para ativar a entrega pela Cora.");
  // Validate before authentication or any bank request.
  const receiverUrl = validateWebhookUrl(url);
  const probe = await fetch(receiverUrl, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { "webhook-event-id": `evt_probe_${randomUUID()}`,
      "webhook-event-type": "transfer.completed", "webhook-resource-id": `trn_probe_${randomUUID()}` }
  });
  if (probe.status !== 202 || (await probe.json())?.received !== true) {
    throw new Error("Informe um receptor público que responda aos avisos antes de cadastrar na Cora.");
  }
  const result = await ensureTransferWebhook(gateway, url);
  console.log(JSON.stringify({ context, created: result.created, id: result.endpoint.id,
    resource: result.endpoint.resource, trigger: result.endpoint.trigger, active: result.endpoint.active }, null, 2));
}

main().catch((error) => {
  // Only our fixed operational messages are exposed, never bank payloads or credentials.
  const message = error instanceof Error && /^(Informe|Use |Configure|A Cora ainda|O sistema está)/.test(error.message)
    ? error.message : "Não foi possível confirmar o cadastro. Consulte cora:webhook -- --check antes de tentar novamente.";
  console.error(message);
  process.exitCode = 1;
});
