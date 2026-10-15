import { customerFinanceService } from "@pontalti/modules/v1/customer-finance/routes";

/** Opt-in, read-only bank polling: no transfer and no invoice emission in this worker. */
export function startCustomerDepositWorker() {
  if (process.env.CORA_CUSTOMER_DEPOSIT_WORKER_ENABLED !== "true") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await customerFinanceService.tick();
    } catch {
      console.error("Conferência de depósitos: consulta incompleta; confira a configuração financeira.");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
