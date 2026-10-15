import { bankingService } from "@pontalti/modules/v1/banking/routes";

export function startCoraPayrollWorker() {
  if (process.env.CORA_PAYROLL_WORKER_ENABLED !== "true") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const results = await Promise.allSettled([bankingService.tick(), bankingService.payments.tick()]);
      if (results.some(result => result.status === "rejected")) throw new Error("Incomplete banking cycle");
    }
    catch { console.error("Processador de folhas Cora: ciclo não concluído; consulte a configuração e o banco de dados."); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
