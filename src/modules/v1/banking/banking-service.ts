import { createHash } from "node:crypto";
import { BankPayrollRun, BankTransfer, Prisma, PrismaClient } from "@prisma/client";
import { cpf } from "cpf-cnpj-validator";
import createError from "http-errors";
import { InferType } from "yup";
import { CoraError, CoraGateway } from "@pontalti/integrations/cora/client";
import { accountSchema, payrollSchema, settingsSchema, validateBody } from "./banking-schema";
import { BankingNotifications, recordBankNotification } from "./banking-notifications";
import { PaymentService } from "./payment-service";
import {
  dateInSaoPaulo, Destination, KIND_LABELS, maskDestination, matchesTransfer, nextStatus,
  normalizeStatus, RemoteTransfer, saoPauloInstant, TransferPayload, validDate, validateSchedule
} from "./banking-domain";

type Tx = Prisma.TransactionClient;
type TransferWithRun = BankTransfer & { run: BankPayrollRun };
const cpfDigits = (value: string) => value.replace(/\D/g, "");
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const requestHash = (data: InferType<typeof payrollSchema>) => createHash("sha256").update(JSON.stringify({
  id: data.id, competence: data.competence, kind: data.kind, payment_date: data.payment_date,
  submit_at_local: data.submit_at_local, auto_submit_to_cora: data.auto_submit_to_cora,
  items: [...data.items].sort((a, b) => a.employee_id - b.employee_id).map((item) => ({ employee_id: item.employee_id, amount_cents: item.amount_cents }))
})).digest("hex");

export class BankingService {
  constructor(readonly db: PrismaClient, readonly cora: CoraGateway, readonly now = () => new Date()) {}

  get notifications() { return new BankingNotifications(this.db, this.cora.context().connectionKey, this.now); }
  get payments() { return new PaymentService(this.db, this.cora, this.now); }

  private audit(tx: Tx, action: string, resourceId: string, userId: number | null,
    runId: string | null, details: Prisma.InputJsonValue = {}) {
    return tx.financialAuditEvent.create({ data: {
      action, resource_id: resourceId, user_id: userId, run_id: runId, details
    } });
  }

  private async lockRun(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "BankPayrollRun" WHERE id = ${id}::uuid FOR UPDATE`;
    const run = await tx.bankPayrollRun.findUnique({ where: { id } });
    if (!run) throw createError(404, "Folha não encontrada.");
    this.assertConnection(run);
    return run;
  }

  private assertConnection(run: BankPayrollRun) {
    const context = this.cora.context();
    if (context.connectionKey !== run.connection_key || context.environment !== run.environment) {
      throw createError(409, "Esta folha pertence a outra conta ou ambiente da Cora.");
    }
  }

  private requireConfigured() {
    const context = this.cora.context();
    if (!context.configured) throw createError(503, "Configure a conexão Cora na API antes de criar uma folha.");
    return context;
  }

  async overview() {
    const { connectionKey, ...context } = this.cora.context();
    const [payroll, payments] = await Promise.all([
      this.db.bankTransfer.groupBy({ by: ["status"], where: { connection_key: connectionKey }, _count: true }),
      this.db.bankPayment.groupBy({ by: ["status"], where: { connection_key: connectionKey }, _count: true })
    ]);
    const counts = new Map<BankTransfer["status"], number>();
    for (const item of [...payroll, ...payments]) counts.set(item.status, (counts.get(item.status) ?? 0) + item._count);
    return { ...context, timezone: "America/Sao_Paulo", counts: Array.from(counts.entries()).map(([status, _count]) => ({ status, _count })) };
  }

  async employees() {
    const employees = await this.db.employees.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, cpf: true, salary: true, dismissal_date: true, bankAccount: true }
    });
    return employees.map(({ cpf: document, bankAccount, ...employee }) => ({
      ...employee, cpf_valid: cpf.isValid(document), cpf_masked: `***${cpfDigits(document).slice(-4)}`,
      bank_account: bankAccount ? { ...maskDestination({ ...bankAccount,
        holder: { name: employee.name, document: { identity: cpfDigits(document), type: "CPF" } }
      }), version: bankAccount.version, account_type: bankAccount.account_type } : null
    }));
  }

  async account(employeeId: number) {
    const employee = await this.db.employees.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!employee) throw createError(404, "Funcionário não encontrado.");
    return this.db.bankEmployeeAccount.findUnique({ where: { employee_id: employeeId } });
  }

  async saveAccount(employeeId: number, body: unknown, userId: number) {
    const { version, ...data } = await validateBody(accountSchema, body);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employees" WHERE id = ${employeeId} FOR UPDATE`;
      const employee = await tx.employees.findUnique({ where: { id: employeeId } });
      if (!employee) throw createError(404, "Funcionário não encontrado.");
      if (!cpf.isValid(employee.cpf)) throw createError(400, "Corrija o CPF do funcionário antes de cadastrar a conta.");
      const current = await tx.bankEmployeeAccount.findUnique({ where: { employee_id: employeeId } });
      if ((current?.version ?? 0) !== version) throw createError(409, "A conta foi alterada. Atualize a página.");
      const result = await tx.bankEmployeeAccount.upsert({ where: { employee_id: employeeId },
        create: { ...data, employee_id: employeeId } as Prisma.BankEmployeeAccountUncheckedCreateInput,
        update: { ...data, version: { increment: 1 } } });
      await this.audit(tx, "EMPLOYEE_BANK_ACCOUNT_UPDATED", String(employeeId), userId, null, { version: result.version });
      return result;
    });
  }

  private async prepareItems(tx: Tx, data: InferType<typeof payrollSchema>) {
    const ids = data.items.map((item) => item.employee_id);
    if (new Set(ids).size !== ids.length) throw createError(400, "Um funcionário só pode aparecer uma vez na folha.");
    const employees = await tx.employees.findMany({ where: { id: { in: ids } }, include: { bankAccount: true } });
    return data.items.map((item) => {
      const employee = employees.find((e) => e.id === item.employee_id);
      if (!employee || !employee.bankAccount || !cpf.isValid(employee.cpf)) {
        throw createError(400, `Funcionário ${item.employee_id}: confira o cadastro, CPF e conta bancária.`);
      }
      if (employee.dismissal_date && dateOnly(employee.dismissal_date) <= data.payment_date) {
        throw createError(400, `${employee.name}: desligamento anterior ou igual à data de pagamento.`);
      }
      const { bank_code, branch_number, account_number, account_type, version } = employee.bankAccount;
      const destination: Destination = { bank_code, branch_number, account_number, account_type,
        holder: { name: employee.name, document: { identity: cpfDigits(employee.cpf), type: "CPF" } } };
      return { employee_id: employee.id, amount_cents: item.amount_cents, beneficiary_name: employee.name,
        destination, account_version: version, connection_key: this.cora.context().connectionKey };
    });
  }

  async createPayroll(body: unknown, userId: number) {
    const data = await validateBody(payrollSchema, body);
    const context = this.requireConfigured();
    const hash = requestHash(data);
    const existing = await this.db.bankPayrollRun.findUnique({ where: { id: data.id } });
    if (existing) {
      this.assertConnection(existing);
      if (existing.request_hash !== hash) throw createError(409, "Esta referência já foi usada para outra versão da folha.");
      return this.payroll(existing.id);
    }
    const submitAt = saoPauloInstant(data.submit_at_local);
    validateSchedule(data.payment_date, submitAt, this.now());
    await this.db.$transaction(async (tx) => {
      const transfers = await this.prepareItems(tx, data);
      await tx.bankPayrollRun.create({ data: {
        id: data.id, request_hash: hash, competence: data.competence, kind: data.kind,
        environment: context.environment, connection_key: context.connectionKey,
        payment_date: new Date(`${data.payment_date}T00:00:00Z`), submit_at: submitAt,
        auto_submit_to_cora: data.auto_submit_to_cora, created_by: userId,
        transfers: { create: transfers }
      } });
      await this.audit(tx, "PAYROLL_CREATED", data.id, userId, data.id,
        { auto_submit_to_cora: data.auto_submit_to_cora, total_cents: transfers.reduce((sum, t) => sum + t.amount_cents, 0) });
    });
    return this.payroll(data.id);
  }

  async revisePayroll(id: string, body: unknown, userId: number) {
    const data = await validateBody(payrollSchema, body);
    if (data.id !== id) throw createError(400, "Referência de folha inválida.");
    const submitAt = saoPauloInstant(data.submit_at_local);
    validateSchedule(data.payment_date, submitAt, this.now());
    await this.db.$transaction(async (tx) => {
      const run = await this.lockRun(tx, id);
      if (run.version !== data.version) throw createError(409, "A folha mudou. Atualize a página antes de revisar.");
      const attempted = await tx.bankTransfer.count({ where: { run_id: id, OR: [
        { attempts: { gt: 0 } }, { status: { notIn: ["DRAFT", "CANCELLED"] } }
      ] } });
      if (attempted) throw createError(409, "Só é possível revisar uma folha antes de qualquer tentativa de envio. Pause e retire os itens da fila primeiro.");
      const transfers = await this.prepareItems(tx, data);
      await tx.bankTransfer.deleteMany({ where: { run_id: id } });
      await tx.bankPayrollRun.update({ where: { id }, data: {
        request_hash: requestHash(data), competence: data.competence, kind: data.kind,
        payment_date: new Date(`${data.payment_date}T00:00:00Z`), submit_at: submitAt,
        auto_submit_to_cora: data.auto_submit_to_cora, paused: true, version: { increment: 1 },
        transfers: { create: transfers }
      } });
      await this.audit(tx, "PAYROLL_REVISED_AND_PAUSED", id, userId, id, {
        items: transfers.map((t) => ({ employee_id: t.employee_id, amount_cents: t.amount_cents }))
      });
    });
    return this.payroll(id);
  }

  async payrolls() {
    const runs = await this.db.bankPayrollRun.findMany({
      where: { connection_key: this.cora.context().connectionKey }, orderBy: { created_at: "desc" }, take: 100,
      include: { transfers: { select: { status: true, amount_cents: true } } }
    });
    return runs.map(({ connection_key, request_hash, transfers, ...run }) => ({
      ...run, total_cents: transfers.reduce((sum, t) => sum + t.amount_cents, 0),
      employee_count: transfers.length, statuses: transfers.map((t) => t.status)
    }));
  }

  async payroll(id: string) {
    const run = await this.db.bankPayrollRun.findUnique({ where: { id }, include: {
      transfers: { orderBy: { beneficiary_name: "asc" } },
      audit: { orderBy: { created_at: "desc" }, take: 100, include: { user: { select: { name: true } } } }
    } });
    if (!run) throw createError(404, "Folha não encontrada.");
    this.assertConnection(run);
    const { connection_key, request_hash, transfers, ...safeRun } = run;
    return { ...safeRun, total_cents: transfers.reduce((sum, t) => sum + t.amount_cents, 0),
      transfers: transfers.map(({ destination, connection_key, idempotency_key, ...transfer }) => ({
        ...transfer, destination: maskDestination(destination as Destination)
      })) };
  }

  async settings(id: string, body: unknown, userId: number) {
    const data = await validateBody(settingsSchema, body);
    await this.db.$transaction(async (tx) => {
      const run = await this.lockRun(tx, id);
      if (run.version !== data.version) throw createError(409, "A folha mudou. Atualize a página.");
      if (!data.paused) validateSchedule(dateOnly(run.payment_date), run.submit_at, this.now());
      await tx.bankPayrollRun.update({ where: { id }, data: {
        auto_submit_to_cora: data.auto_submit_to_cora, paused: data.paused, version: { increment: 1 }
      } });
      if (data.paused || !data.auto_submit_to_cora) {
        await tx.bankTransfer.updateMany({ where: { run_id: id, status: "QUEUED" }, data: { status: "DRAFT" } });
      }
      await this.audit(tx, "PAYROLL_SETTINGS_UPDATED", id, userId, id, data);
    });
    return this.payroll(id);
  }

  async release(id: string, userId: number | null, automatic = false, expectedVersion?: number) {
    await this.db.$transaction(async (tx) => {
      const run = await this.lockRun(tx, id);
      if (!automatic && run.version !== expectedVersion) throw createError(409, "A folha mudou. Confira os valores atualizados antes de liberar.");
      if (run.paused) throw createError(409, "Retome a folha antes de liberar o envio.");
      validateSchedule(dateOnly(run.payment_date), run.submit_at, this.now());
      if (automatic && (!run.auto_submit_to_cora || run.submit_at > this.now())) return;
      const context = this.requireConfigured();
      if (!context.transfersEnabled || !context.workerEnabled) {
        throw createError(503, "O envio e o processador de folhas precisam estar habilitados na API.");
      }
      const result = await tx.bankTransfer.updateMany({ where: { run_id: id, status: "DRAFT" }, data: { status: "QUEUED" } });
      if (result.count) {
        await tx.bankPayrollRun.update({ where: { id }, data: { version: { increment: 1 } } });
        await this.audit(tx, automatic ? "PAYROLL_AUTO_RELEASED" : "PAYROLL_RELEASED", id, userId, id, { count: result.count });
      }
    });
    return this.payroll(id);
  }

  async transferAction(runId: string, id: string, action: "cancel" | "retry", userId: number) {
    await this.db.$transaction(async (tx) => {
      const run = await this.lockRun(tx, runId);
      await tx.$queryRaw`SELECT id FROM "BankTransfer" WHERE id = ${id}::uuid FOR UPDATE`;
      const transfer = await tx.bankTransfer.findUnique({ where: { id } });
      if (!transfer || transfer.run_id !== runId) throw createError(404, "Transferência não encontrada.");
      if (action === "cancel") {
        if (!["DRAFT", "QUEUED", "FAILED"].includes(transfer.status)) {
          throw createError(409, "A instrução já pode estar no banco. Consulte a Cora para cancelar.");
        }
        await tx.bankTransfer.update({ where: { id }, data: { status: "CANCELLED", last_error: null } });
      } else {
        if (transfer.status !== "FAILED" || run.paused) throw createError(409, "Apenas falhas sem envio incerto podem ser tentadas novamente; a folha deve estar ativa.");
        validateSchedule(dateOnly(run.payment_date), run.submit_at, this.now());
        const context = this.requireConfigured();
        if (!context.transfersEnabled || !context.workerEnabled) throw createError(503, "Envio desabilitado na API.");
        await tx.bankTransfer.update({ where: { id }, data: { status: "QUEUED", last_error: null } });
      }
      await this.audit(tx, action === "cancel" ? "TRANSFER_CANCELLED_LOCALLY" : "TRANSFER_RETRY_REQUESTED", id, userId, runId);
    });
    return this.payroll(runId);
  }

  private payload(transfer: TransferWithRun): TransferPayload {
    return { destination: transfer.destination as Destination, amount: transfer.amount_cents,
      code: transfer.id, description: `${KIND_LABELS[transfer.run.kind]} ${transfer.run.competence}`,
      category: "PAYROLL", scheduled: dateOnly(transfer.run.payment_date) };
  }

  async dispatch(id: string) {
    const context = this.cora.context();
    if (!context.configured || !context.transfersEnabled || !context.workerEnabled) return;
    const candidate = await this.db.bankTransfer.findUnique({ where: { id } });
    if (!candidate || candidate.connection_key !== context.connectionKey) return;
    const claimed = await this.db.$transaction(async (tx) => {
      const run = await this.lockRun(tx, candidate.run_id);
      await tx.$queryRaw`SELECT id FROM "BankTransfer" WHERE id = ${id}::uuid FOR UPDATE`;
      const transfer = await tx.bankTransfer.findUnique({ where: { id } });
      if (run.paused || transfer.status !== "QUEUED") return null;
      await tx.$queryRaw`SELECT id FROM "Employees" WHERE id = ${transfer.employee_id} FOR UPDATE`;
      const employee = await tx.employees.findUnique({ where: { id: transfer.employee_id }, include: { bankAccount: true } });
      let problem: string | undefined;
      if (dateOnly(run.payment_date) < dateInSaoPaulo(this.now())) problem = "Data de pagamento vencida. Revise a folha antes do envio.";
      else if (employee.bankAccount?.version !== transfer.account_version ||
        cpfDigits(employee.cpf) !== (transfer.destination as Destination).holder.document.identity ||
        employee.name !== transfer.beneficiary_name) problem = "Cadastro ou conta alterados. Revise a folha antes do envio.";
      else if (employee.dismissal_date && dateOnly(employee.dismissal_date) <= dateOnly(run.payment_date)) problem = "Funcionário desligado antes da data de pagamento.";
      if (problem) {
        await tx.bankTransfer.update({ where: { id }, data: { status: "DRAFT", last_error: problem } });
        await tx.bankPayrollRun.update({ where: { id: run.id }, data: { paused: true, version: { increment: 1 } } });
        await this.audit(tx, "PAYROLL_PAUSED_BY_VALIDATION", id, null, run.id, { reason: problem });
        return null;
      }
      const result = await tx.bankTransfer.update({ where: { id }, data: {
        status: "SUBMITTING", attempts: { increment: 1 }, last_error: null,
        lease_until: new Date(this.now().getTime() + 120_000)
      } });
      await this.audit(tx, "TRANSFER_SUBMISSION_STARTED", id, null, run.id, { attempt: result.attempts });
      return { ...result, run };
    });
    if (!claimed) return;
    try {
      const remote = await this.cora.initiateTransfer(this.payload(claimed), claimed.idempotency_key);
      await this.applyRemote(id, remote);
    } catch (error) {
      const bankError = error instanceof CoraError ? error : new CoraError(true, false);
      const status = bankError.uncertain ? "UNKNOWN" : bankError.retryable ? "FAILED" : "REJECTED";
      await this.db.$transaction(async (tx) => {
        await this.lockRun(tx, claimed.run_id);
        const changed = await tx.bankTransfer.updateMany({ where: { id, status: "SUBMITTING" }, data: {
          status, lease_until: null, last_error: bankError.message
        } });
        if (changed.count) await this.audit(tx, "TRANSFER_SUBMISSION_RESULT", id, null, claimed.run_id, { status });
      });
    }
  }

  async applyRemote(id: string, remote: RemoteTransfer) {
    const candidate = await this.db.bankTransfer.findUnique({ where: { id }, select: { run_id: true } });
    if (!candidate) return;
    return this.db.$transaction(async (tx) => {
      // Always lock parent before child: audit FKs also acquire a lock on the parent.
      await this.lockRun(tx, candidate.run_id);
      await tx.$queryRaw`SELECT id FROM "BankTransfer" WHERE id = ${id}::uuid FOR UPDATE`;
      const transfer = await tx.bankTransfer.findUnique({ where: { id }, include: { run: true } });
      if (!transfer) return;
      this.assertConnection(transfer.run);
      if (!matchesTransfer(this.payload(transfer), remote, transfer.remote_id)) {
        if (!["COMPLETED", "REFUNDED"].includes(transfer.status)) await tx.bankTransfer.update({ where: { id }, data: {
          status: "UNKNOWN", lease_until: null, last_error: "Os dados retornados pelo banco não conferem com a instrução. Confira na Cora."
        } });
        await this.audit(tx, "TRANSFER_RESPONSE_MISMATCH", id, null, transfer.run_id);
        return;
      }
      const status = nextStatus(transfer.status, normalizeStatus(remote.status));
      let expenseId = transfer.expense_id;
      let reversalId = transfer.reversal_expense_id;
      const createExpense = async (reversal: boolean) => {
        let actor = await tx.expenseActor.findFirst({ where: { employee_id: transfer.employee_id } });
        if (!actor) actor = await tx.expenseActor.create({ data: { employee_id: transfer.employee_id,
          first_name: transfer.beneficiary_name.slice(0, 100) } });
        return tx.expenses.create({ data: {
          amount: new Prisma.Decimal(transfer.amount_cents).div(100).mul(reversal ? -1 : 1),
          classification: "Folha de pagamento",
          description: `${reversal ? "Estorno • " : ""}${KIND_LABELS[transfer.run.kind]} ${transfer.run.competence} • ${transfer.beneficiary_name}`.slice(0, 150),
          justification: `Confirmação Cora ${remote.id}. Folha ${transfer.run_id}. Data de confirmação bancária.`,
          requires_reimbursement: false, applies_all_products: false, applies_all_machines: false,
          expense_date: this.now(), expense_actor_id: actor.id, created_by: "Cora"
        } });
      };
      if (status === "COMPLETED" && !expenseId && transfer.run.environment === "PRODUCTION") expenseId = (await createExpense(false)).id;
      if (status === "REFUNDED" && expenseId && !reversalId) reversalId = (await createExpense(true)).id;
      const updated = await tx.bankTransfer.update({ where: { id }, data: {
        status, remote_id: remote.id, remote_status: remote.status.slice(0, 100), lease_until: null,
        last_error: status === "UNKNOWN" ? "Status bancário ainda não reconhecido. Consulte a Cora." : null,
        submitted_at: transfer.submitted_at ?? this.now(), last_checked_at: this.now(),
        completed_at: status === "COMPLETED" ? transfer.completed_at ?? this.now() : transfer.completed_at,
        refunded_at: status === "REFUNDED" ? transfer.refunded_at ?? this.now() : null,
        expense_id: expenseId, reversal_expense_id: reversalId
      } });
      await recordBankNotification(tx, updated, this.now());
      if (status !== transfer.status || remote.id !== transfer.remote_id) {
        await this.audit(tx, "TRANSFER_BANK_STATUS", id, null, transfer.run_id, { status, remote_id: remote.id });
      }
    });
  }

  async sync(id: string, userId: number | null = null) {
    const run = await this.db.bankPayrollRun.findUnique({ where: { id }, include: { transfers: true } });
    if (!run) throw createError(404, "Folha não encontrada.");
    this.assertConnection(run);
    this.requireConfigured();
    const start = dateInSaoPaulo(new Date(run.created_at.getTime() - 86400000));
    const end = dateInSaoPaulo(new Date(this.now().getTime() + 86400000));
    const warnings: string[] = [];
    // Cora publishes separate status filters. Absence from a result never changes local status.
    for (const status of ["INITIATED", "SCHEDULED", "COMPLETED", "CANCELLED", "REFUNDED"]) {
      try {
        for (let page = 0; page < 100; page++) {
          const result = await this.cora.transfers(status, start, end, page);
          for (const remote of result.content) {
            const transfer = run.transfers.find((t) => t.id === remote.code || (t.remote_id && t.remote_id === remote.id));
            if (transfer && transfer.attempts > 0) await this.applyRemote(transfer.id, remote);
          }
          if (!result.hasMore) break;
          if (page === 99) warnings.push(`Consulta ${status} atingiu o limite de páginas.`);
        }
      } catch { warnings.push(`Não foi possível consultar o status ${status} na Cora.`); }
    }
    if (!warnings.length) {
      await this.db.bankWebhookEvent.updateMany({ where: { connection_key: run.connection_key,
        resource_id: { in: run.transfers.flatMap((t) => t.remote_id ? [t.remote_id] : []) }, processed_at: null
      }, data: { processed_at: this.now() } });
    }
    if (userId) await this.audit(this.db, "PAYROLL_SYNC_REQUESTED", id, userId, id, { warnings });
    return { payroll: await this.payroll(id), warnings };
  }

  async webhook(eventId: string, resourceId: string, eventType: string) {
    if (![eventId, resourceId, eventType].every((s) => typeof s === "string" && /^[\w.:-]{1,150}$/.test(s))) return;
    if (!["transfer.completed", "transfer.canceled", "transfer.refunded"].includes(eventType.toLowerCase())) return;
    const connection_key = this.cora.context().connectionKey;
    const known = await this.db.bankTransfer.findFirst({ where: { connection_key, remote_id: resourceId } });
    if (!known && !await this.db.bankPayment.findFirst({ where: { connection_key, remote_id: resourceId } })) return;
    // Public headers only request a fresh authenticated read; they never settle a transfer.
    if (await this.db.bankWebhookEvent.findFirst({ where: { connection_key, resource_id: resourceId, processed_at: null } })) return;
    await this.db.bankWebhookEvent.upsert({ where: { connection_key_event_id: { connection_key, event_id: eventId } },
      create: { connection_key, event_id: eventId, resource_id: resourceId, event_type: eventType }, update: {} });
  }

  async tick() {
    const context = this.cora.context();
    if (!context.configured || !context.workerEnabled) return;
    const expired = await this.db.bankTransfer.findMany({ where: { connection_key: context.connectionKey,
      status: "SUBMITTING", lease_until: { lt: this.now() } }, select: { id: true, run_id: true } });
    for (const transfer of expired) await this.db.$transaction(async (tx) => {
      await this.lockRun(tx, transfer.run_id);
      const changed = await tx.bankTransfer.updateMany({ where: { id: transfer.id, status: "SUBMITTING", lease_until: { lt: this.now() } },
        data: { status: "UNKNOWN", lease_until: null, last_error: "Envio interrompido. Sincronize com a Cora; não crie outra transferência." } });
      if (changed.count) await this.audit(tx, "TRANSFER_LEASE_EXPIRED", transfer.id, null, transfer.run_id);
    });
    if (context.transfersEnabled) {
      const due = await this.db.bankPayrollRun.findMany({ where: { connection_key: context.connectionKey,
        auto_submit_to_cora: true, paused: false, submit_at: { lte: this.now() },
        transfers: { some: { status: "DRAFT" } } }, take: 20, orderBy: { submit_at: "asc" } });
      for (const run of due) {
        try { await this.release(run.id, null, true); }
        catch (error) {
          if ((error as { status?: number }).status === 400) {
            await this.db.$transaction(async (tx) => {
              await this.lockRun(tx, run.id);
              await tx.bankPayrollRun.update({ where: { id: run.id }, data: { paused: true, version: { increment: 1 } } });
              await this.audit(tx, "PAYROLL_EXPIRED", run.id, null, run.id);
            });
          }
        }
      }
      const queued = await this.db.bankTransfer.findMany({ where: { connection_key: context.connectionKey,
        status: "QUEUED", run: { paused: false } }, orderBy: { created_at: "asc" }, take: 10 });
      for (const transfer of queued) await this.dispatch(transfer.id);
    }
    const runs = await this.db.bankPayrollRun.findMany({ where: { connection_key: context.connectionKey,
      transfers: { some: { attempts: { gt: 0 }, OR: [
        { status: { in: ["INITIATED", "SCHEDULED", "UNKNOWN"] } },
        { status: "COMPLETED", completed_at: { gte: new Date(this.now().getTime() - 30 * 86400000) } }
      ], AND: [{ OR: [{ last_checked_at: null }, { last_checked_at: { lt: new Date(this.now().getTime() - 300000) } }] }] } }
    }, orderBy: { updated_at: "asc" }, take: 5 });
    const pending = await this.db.bankWebhookEvent.findMany({ where: { connection_key: context.connectionKey, processed_at: null }, take: 20 });
    const hinted = await this.db.bankTransfer.findMany({ where: { connection_key: context.connectionKey,
      remote_id: { in: pending.map((event) => event.resource_id) } }, select: { run_id: true } });
    for (const id of Array.from(new Set([...runs.map((r) => r.id), ...hinted.map((t) => t.run_id)]))) {
      try {
        const result = await this.sync(id);
        // Fair polling even when the bank returns no match or one status filter is unavailable.
        if (!result.warnings.length) await this.db.bankTransfer.updateMany({ where: { run_id: id, attempts: { gt: 0 } }, data: { last_checked_at: this.now() } });
        await this.db.bankPayrollRun.update({ where: { id }, data: { updated_at: this.now() } });
      } catch { /* Retry on the next tick without resending instructions. */ }
    }
  }

  async statement(start: string, end: string, page: number) {
    if (!validDate(start) || !validDate(end) || start > end ||
      new Date(end).getTime() - new Date(start).getTime() > 90 * 86400000 || !Number.isInteger(page) || page < 1 || page > 1000) {
      throw createError(400, "Informe um período de até 90 dias e uma página válida.");
    }
    const result = await this.cora.statement(start, end, page) as { entries?: unknown[] | null };
    // Cora returns null for an empty statement; the frontend consumes a list.
    const entries = result?.entries === null ? [] : result?.entries;
    if (!Array.isArray(entries)) throw createError(502, "Extrato Cora em formato não reconhecido.");
    return { ...result, entries, page, has_more: entries.length === 100 };
  }
}
