import { createHash } from "node:crypto";
import {
  BankBeneficiary,
  BankPayment,
  BankPaymentPurpose,
  BankTransferStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import createError from "http-errors";
import { CoraError, CoraGateway } from "@pontalti/integrations/cora/client";
import {
  dateInSaoPaulo,
  Destination,
  maskDestination,
  matchesTransfer,
  MAX_AMOUNT_CENTS,
  nextStatus,
  normalizeStatus,
  RemoteTransfer,
  TransferPayload
} from "./banking-domain";
import { validateBody, versionSchema } from "./banking-schema";
import {
  beneficiarySchema,
  decodeReceipt,
  payableSchema,
  payableRevisionSchema,
  paymentSchema,
  receiptSchema
} from "./payment-schema";
import { recordPaymentNotification } from "./banking-notifications";

type Tx = Prisma.TransactionClient;
export const RESERVING_STATUSES: BankTransferStatus[] = [
  "DRAFT",
  "QUEUED",
  "SUBMITTING",
  "INITIATED",
  "SCHEDULED",
  "UNKNOWN",
  "FAILED"
];
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const digits = (value: string) => value.replace(/\D/g, "");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const purposeLabels = { SUPPLIER: "Fornecedor", REIMBURSEMENT: "Reembolso" };
const receiptSelect = { id: true, name: true, mime: true, size: true, created_at: true } as const;
const payableInclude = {
  beneficiary: true,
  expense: { select: { id: true, amount: true, description: true, classification: true, expense_date: true } },
  receipts: { select: receiptSelect },
  allocations: {
    include: {
      payment: {
        select: { id: true, status: true, attempts: true, payment_date: true, completed_at: true, refunded_at: true }
      }
    }
  }
} as const;

export function payableBalance(
  total: number,
  allocations: { amount_cents: number; payment: { status: BankTransferStatus } }[]
) {
  const paid_cents = allocations
    .filter((row) => row.payment.status === "COMPLETED")
    .reduce((sum, row) => sum + row.amount_cents, 0);
  const reserved_cents = allocations
    .filter((row) => RESERVING_STATUSES.includes(row.payment.status))
    .reduce((sum, row) => sum + row.amount_cents, 0);
  return {
    paid_cents,
    reserved_cents,
    remaining_cents: Math.max(0, total - paid_cents),
    available_cents: Math.max(0, total - paid_cents - reserved_cents),
    overpaid_cents: Math.max(0, paid_cents - total)
  };
}

export class PaymentService {
  constructor(
    readonly db: PrismaClient,
    readonly cora: CoraGateway,
    readonly now = () => new Date()
  ) {}

  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        // One ordering for reservations, settlements, expense edits and beneficiary changes.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('pontalti-bank-payments'))`;
        return fn(tx);
      },
      { maxWait: 10000, timeout: 15000 }
    );
  }
  private scope() {
    return { connection_key: this.cora.context().connectionKey };
  }
  private audit(tx: Tx, action: string, id: string, userId: number | null, details: Prisma.InputJsonValue = {}) {
    return tx.financialAuditEvent.create({ data: { action, resource_id: id, user_id: userId, details } });
  }
  private destination(beneficiary: BankBeneficiary): Destination {
    return {
      bank_code: beneficiary.bank_code,
      branch_number: beneficiary.branch_number,
      account_number: beneficiary.account_number,
      account_type: beneficiary.account_type,
      holder: {
        name: beneficiary.name,
        document: { identity: beneficiary.document, type: beneficiary.document_type as "CPF" | "CNPJ" }
      }
    };
  }
  private safeBeneficiary(beneficiary: BankBeneficiary) {
    const { document, account_number, connection_key, ...safe } = beneficiary;
    return { ...safe, ...maskDestination(this.destination(beneficiary)) };
  }
  private async findBeneficiary(tx: Tx | PrismaClient, id: string) {
    const row = await tx.bankBeneficiary.findFirst({ where: { id, ...this.scope() } });
    if (!row) throw createError(404, "Favorecido não encontrado nesta conta Cora.");
    return row;
  }
  private async findPayable(tx: Tx | PrismaClient, id: string) {
    const row = await tx.bankPayable.findFirst({ where: { id, ...this.scope() }, include: payableInclude });
    if (!row || row.environment !== this.cora.context().environment)
      throw createError(404, "Obrigação não encontrada nesta conta Cora.");
    return row;
  }
  private async findPayment(tx: Tx | PrismaClient, id: string) {
    const row = await tx.bankPayment.findFirst({ where: { id, ...this.scope() }, include: { allocations: true } });
    if (!row || row.environment !== this.cora.context().environment)
      throw createError(404, "Pagamento não encontrado nesta conta Cora.");
    return row;
  }
  private safePayable(row: Awaited<ReturnType<PaymentService["findPayable"]>>) {
    const { connection_key, beneficiary, ...safe } = row;
    return {
      ...safe,
      beneficiary: this.safeBeneficiary(beneficiary),
      ...payableBalance(row.total_cents, row.allocations)
    };
  }

  async references() {
    const [employees, vendors] = await Promise.all([
      this.db.employees.findMany({
        select: { id: true, name: true, cpf: true, bankAccount: true },
        orderBy: { name: "asc" },
        take: 500
      }),
      this.db.vendors.findMany({ select: { id: true, name: true, cnpj: true }, orderBy: { name: "asc" }, take: 500 })
    ]);
    return { employees, vendors };
  }
  async beneficiaries() {
    const rows = await this.db.bankBeneficiary.findMany({ where: this.scope(), orderBy: { name: "asc" }, take: 500 });
    return rows.map((row) => this.safeBeneficiary(row));
  }
  async beneficiary(id: string) {
    const { connection_key, ...safe } = await this.findBeneficiary(this.db, id);
    return safe;
  }
  async saveBeneficiary(id: string | null, body: unknown, userId: number) {
    const { version, ...data } = await validateBody(beneficiarySchema, body);
    return this.write(async (tx) => {
      const current = id ? await this.findBeneficiary(tx, id) : null;
      if ((current?.version ?? 0) !== version) throw createError(409, "O favorecido mudou. Atualize o cadastro.");
      if (data.employee_id) {
        const employee = await tx.employees.findUnique({ where: { id: data.employee_id } });
        if (
          !employee ||
          digits(employee.cpf) !== data.document ||
          employee.name !== data.name ||
          data.document_type !== "CPF"
        ) {
          throw createError(400, "Nome e CPF devem corresponder ao funcionário selecionado.");
        }
      }
      if (data.vendor_id) {
        const vendor = await tx.vendors.findUnique({ where: { id: data.vendor_id } });
        if (
          !vendor ||
          digits(vendor.cnpj) !== data.document ||
          data.document_type !== "CNPJ" ||
          vendor.name !== data.name
        ) {
          throw createError(400, "Nome e CNPJ devem corresponder ao fornecedor selecionado.");
        }
      }
      if (
        current &&
        (current.document !== data.document ||
          current.employee_id !== data.employee_id ||
          current.vendor_id !== data.vendor_id) &&
        (await tx.bankPayable.count({ where: { beneficiary_id: id! } }))
      ) {
        throw createError(
          409,
          "Este favorecido já possui obrigações. Cadastre outro favorecido para mudar sua identidade."
        );
      }
      const row = current
        ? await tx.bankBeneficiary.update({ where: { id: id! }, data: { ...data, version: { increment: 1 } } })
        : await tx.bankBeneficiary.create({
            data: { ...data, ...this.scope() } as Prisma.BankBeneficiaryUncheckedCreateInput
          });
      await this.audit(tx, "BENEFICIARY_SAVED", row.id, userId, { version: row.version });
      return this.safeBeneficiary(row);
    });
  }

  async expenseChoices() {
    return this.db.expenses.findMany({
      where: { payable: null, bankTransfer: null, bankReversal: null },
      select: {
        id: true,
        amount: true,
        description: true,
        classification: true,
        requires_reimbursement: true,
        actor: { select: { vendor_id: true, employee_id: true, first_name: true, last_name: true } }
      },
      orderBy: { id: "desc" },
      take: 300
    });
  }
  async payables() {
    const rows = await this.db.bankPayable.findMany({
      where: this.scope(),
      include: payableInclude,
      orderBy: { created_at: "desc" },
      take: 250
    });
    return rows.map((row) => this.safePayable(row));
  }
  async payable(id: string) {
    const row = await this.findPayable(this.db, id);
    return {
      ...this.safePayable(row),
      audit: await this.db.financialAuditEvent.findMany({
        where: { resource_id: id },
        orderBy: { created_at: "desc" },
        take: 100,
        select: { id: true, action: true, created_at: true, user: { select: { name: true } } }
      })
    };
  }
  async createPayable(body: unknown, userId: number) {
    const data = await validateBody(payableSchema, body);
    const context = this.cora.context();
    await this.write(async (tx) => {
      if (await tx.bankPayable.findUnique({ where: { id: data.id } }))
        throw createError(409, "Esta solicitação já existe. Atualize a lista.");
      const beneficiary = await this.findBeneficiary(tx, data.beneficiary_id);
      if (!beneficiary.active) throw createError(400, "O favorecido está inativo.");
      if (data.purpose === "SUPPLIER" && !beneficiary.vendor_id)
        throw createError(400, "Vincule o favorecido ao fornecedor cadastrado.");
      let expense = data.expense_id
        ? await tx.expenses.findUnique({
            where: { id: data.expense_id },
            include: { actor: true, payable: true, bankTransfer: true, bankReversal: true }
          })
        : null;
      if (data.expense_id && !expense) throw createError(404, "Despesa não encontrada.");
      if (expense?.payable || expense?.bankTransfer || expense?.bankReversal)
        throw createError(409, "Esta despesa já está vinculada a uma operação financeira.");
      if (
        expense &&
        (expense.requires_reimbursement !== (data.purpose === "REIMBURSEMENT") ||
          (data.purpose === "SUPPLIER" && expense.actor.vendor_id !== beneficiary.vendor_id))
      ) {
        throw createError(400, "Confira o fornecedor da despesa e a indicação de reembolso.");
      }
      if (!expense) {
        const actor = await tx.expenseActor.create({
          data: {
            vendor_id: beneficiary.vendor_id,
            employee_id: beneficiary.employee_id,
            first_name: beneficiary.name.slice(0, 100)
          }
        });
        const created = await tx.expenses.create({
          data: {
            amount: new Prisma.Decimal(data.expense!.amount_cents).div(100),
            description: data.expense!.description,
            classification: data.expense!.classification,
            expense_date: new Date(`${data.expense!.expense_date}T12:00:00Z`),
            justification: data.justification,
            requires_reimbursement: data.purpose === "REIMBURSEMENT",
            applies_all_products: false,
            applies_all_machines: false,
            expense_actor_id: actor.id,
            created_by: String(userId)
          }
        });
        expense = { ...created, actor, payable: null, bankTransfer: null, bankReversal: null };
      }
      const amount = new Prisma.Decimal(expense.amount).mul(100);
      if (!amount.isInteger() || amount.lte(0) || amount.gt(MAX_AMOUNT_CENTS))
        throw createError(400, "Valor da despesa fora do limite permitido.");
      await tx.bankPayable.create({
        data: {
          id: data.id,
          ...this.scope(),
          environment: context.environment,
          purpose: data.purpose as BankPaymentPurpose,
          beneficiary_id: beneficiary.id,
          expense_id: expense.id,
          total_cents: amount.toNumber(),
          due_date: new Date(`${data.due_date}T00:00:00Z`),
          justification: data.justification,
          created_by: userId
        }
      });
      await this.audit(tx, "PAYABLE_CREATED", data.id, userId, {
        expense_id: expense.id,
        amount_cents: amount.toNumber()
      });
    });
    return this.payable(data.id);
  }
  async revisePayable(id: string, body: unknown, userId: number) {
    const data = await validateBody(payableRevisionSchema, body);
    await this.write(async (tx) => {
      const row = await this.findPayable(tx, id);
      const balance = payableBalance(row.total_cents, row.allocations);
      if (row.version !== data.version) throw createError(409, "A solicitação mudou. Atualize antes de revisar.");
      if (
        balance.paid_cents ||
        balance.reserved_cents ||
        (await tx.bankPaymentAllocation.count({
          where: { payable_id: id, payment: { attempts: { gt: 0 } } }
        }))
      )
        throw createError(
          409,
          "A solicitação já possui reserva ou tentativa bancária. Cancele os rascunhos antes de revisar; registros já enviados permanecem no histórico original."
        );
      const beneficiary = await this.findBeneficiary(tx, data.beneficiary_id);
      if (!beneficiary.active || (row.purpose === "SUPPLIER" && beneficiary.vendor_id !== row.beneficiary.vendor_id)) {
        throw createError(400, "Confira o favorecido e o fornecedor da despesa.");
      }
      await tx.expenses.update({
        where: { id: row.expense_id },
        data: {
          amount: new Prisma.Decimal(data.expense.amount_cents).div(100),
          description: data.expense.description,
          classification: data.expense.classification,
          expense_date: new Date(`${data.expense.expense_date}T12:00:00Z`),
          justification: data.justification,
          updated_by: String(userId)
        }
      });
      await tx.bankPayable.update({
        where: { id },
        data: {
          beneficiary_id: beneficiary.id,
          total_cents: data.expense.amount_cents,
          due_date: new Date(`${data.due_date}T00:00:00Z`),
          justification: data.justification,
          status: "DRAFT",
          approved_at: null,
          version: { increment: 1 }
        }
      });
      await this.audit(tx, "PAYABLE_REVISED", id, userId, {
        previous_total_cents: row.total_cents,
        total_cents: data.expense.amount_cents,
        previous_beneficiary_id: row.beneficiary_id,
        beneficiary_id: beneficiary.id
      });
    });
    return this.payable(id);
  }
  async payableAction(id: string, action: "approve" | "cancel", body: unknown, userId: number) {
    const { version } = await validateBody(versionSchema, body);
    await this.write(async (tx) => {
      const row = await this.findPayable(tx, id);
      if (row.version !== version) throw createError(409, "A solicitação mudou. Atualize a página.");
      const balance = payableBalance(row.total_cents, row.allocations);
      if (action === "cancel") {
        if (balance.paid_cents || balance.reserved_cents)
          throw createError(409, "Há valores pagos ou reservados. Resolva os pagamentos antes de cancelar.");
      } else {
        if (row.status === "APPROVED") return;
        if (!row.beneficiary.active) throw createError(400, "O favorecido está inativo.");
        if (row.purpose === "REIMBURSEMENT" && !row.receipts.length)
          throw createError(400, "Anexe o comprovante da despesa antes de aprovar o reembolso.");
      }
      await tx.bankPayable.update({
        where: { id },
        data: {
          status: action === "approve" ? "APPROVED" : "CANCELLED",
          approved_at: action === "approve" ? this.now() : null,
          version: { increment: 1 }
        }
      });
      await this.audit(tx, action === "approve" ? "PAYABLE_APPROVED" : "PAYABLE_CANCELLED", id, userId);
    });
    return this.payable(id);
  }
  async addReceipt(id: string, body: unknown, userId: number) {
    const data = await validateBody(receiptSchema, body);
    const content = decodeReceipt(data);
    return this.write(async (tx) => {
      const row = await this.findPayable(tx, id);
      if (row.status !== "DRAFT" || row.receipts.length >= 3)
        throw createError(409, "Anexe até três comprovantes antes da aprovação.");
      const receipt = await tx.bankPayableReceipt.create({
        data: {
          payable_id: id,
          name: data.name.replace(/[\/\\\x00-\x1f]/g, "_"),
          mime: data.mime,
          content,
          size: content.length,
          created_by: userId
        },
        select: receiptSelect
      });
      await tx.bankPayable.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit(tx, "PAYABLE_RECEIPT_ADDED", id, userId, { receipt_id: receipt.id });
      return receipt;
    });
  }
  async removeReceipt(id: string, receiptId: string, body: unknown, userId: number) {
    const { version } = await validateBody(versionSchema, body);
    await this.write(async (tx) => {
      const row = await this.findPayable(tx, id);
      if (row.version !== version || row.status !== "DRAFT")
        throw createError(409, "Atualize a solicitação. Comprovantes só podem ser removidos antes da aprovação.");
      const removed = await tx.bankPayableReceipt.deleteMany({ where: { id: receiptId, payable_id: id } });
      if (!removed.count) throw createError(404, "Comprovante não encontrado.");
      await tx.bankPayable.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit(tx, "PAYABLE_RECEIPT_REMOVED", id, userId, { receipt_id: receiptId });
    });
    return this.payable(id);
  }
  async receipt(id: string, receiptId: string) {
    await this.findPayable(this.db, id);
    const receipt = await this.db.bankPayableReceipt.findFirst({ where: { id: receiptId, payable_id: id } });
    if (!receipt) throw createError(404, "Comprovante não encontrado.");
    return { name: receipt.name, mime: receipt.mime, content_base64: Buffer.from(receipt.content).toString("base64") };
  }

  async payments() {
    const rows = await this.db.bankPayment.findMany({
      where: this.scope(),
      orderBy: { created_at: "desc" },
      take: 150
    });
    return rows.map(({ connection_key, destination, idempotency_key, request_hash, ...row }) => ({
      ...row,
      destination: maskDestination(destination as Destination)
    }));
  }
  async payment(id: string) {
    const row = await this.findPayment(this.db, id);
    const { connection_key, destination, idempotency_key, request_hash, ...safe } = row;
    const payables = await this.db.bankPayable.findMany({
      where: { id: { in: row.allocations.map((item) => item.payable_id) } },
      include: payableInclude
    });
    return {
      ...safe,
      destination: maskDestination(destination as Destination),
      payables: payables.map((item) => this.safePayable(item)),
      audit: await this.db.financialAuditEvent.findMany({
        where: { resource_id: id },
        orderBy: { created_at: "desc" },
        take: 100,
        select: { id: true, action: true, created_at: true, user: { select: { name: true } } }
      })
    };
  }
  async createPayment(body: unknown, userId: number) {
    const data = await validateBody(paymentSchema, body);
    const items = [...data.items].sort((a, b) => a.payable_id.localeCompare(b.payable_id));
    const requestHash = hash({ payment_date: data.payment_date, items });
    await this.write(async (tx) => {
      const existing = await tx.bankPayment.findUnique({ where: { id: data.id } });
      if (existing) {
        if (existing.connection_key !== this.scope().connection_key || existing.request_hash !== requestHash)
          throw createError(409, "Referência já usada para outro pagamento.");
        return;
      }
      if (!this.cora.context().configured)
        throw createError(503, "Configure a conexão com a Cora antes de preparar pagamentos.");
      if (data.payment_date < dateInSaoPaulo(this.now()))
        throw createError(400, "Escolha hoje ou uma data futura para o pagamento.");
      if (new Set(items.map((item) => item.payable_id)).size !== items.length)
        throw createError(400, "Selecione cada despesa uma única vez.");
      let beneficiary: BankBeneficiary | null = null;
      let purpose: BankPaymentPurpose | null = null;
      for (const item of items) {
        const payable = await this.findPayable(tx, item.payable_id);
        if (payable.status !== "APPROVED" || !payable.beneficiary.active)
          throw createError(409, "Aprove as solicitações e confira o favorecido antes de preparar o pagamento.");
        if (beneficiary && (beneficiary.id !== payable.beneficiary_id || purpose !== payable.purpose))
          throw createError(400, "Agrupe apenas despesas do mesmo favorecido e da mesma finalidade.");
        if (item.amount_cents > payableBalance(payable.total_cents, payable.allocations).available_cents)
          throw createError(409, "Valor superior ao saldo disponível de uma das despesas. Atualize os saldos.");
        beneficiary = payable.beneficiary;
        purpose = payable.purpose;
      }
      const amount = items.reduce((sum, item) => sum + item.amount_cents, 0);
      if (amount > MAX_AMOUNT_CENTS) throw createError(400, "O total excede o limite permitido por transferência.");
      await tx.bankPayment.create({
        data: {
          id: data.id,
          ...this.scope(),
          environment: this.cora.context().environment,
          purpose: purpose!,
          beneficiary_id: beneficiary!.id,
          beneficiary_name: beneficiary!.name,
          destination: this.destination(beneficiary!) as unknown as Prisma.InputJsonValue,
          account_version: beneficiary!.version,
          amount_cents: amount,
          payment_date: new Date(`${data.payment_date}T00:00:00Z`),
          request_hash: requestHash,
          created_by: userId,
          allocations: {
            create: items.map((item) => ({ payable_id: item.payable_id, amount_cents: item.amount_cents }))
          }
        }
      });
      await this.audit(tx, "PAYMENT_PREPARED", data.id, userId, { amount_cents: amount, items });
    });
    return this.payment(data.id);
  }
  private async checkDestination(tx: Tx, payment: BankPayment) {
    const beneficiary = await this.findBeneficiary(tx, payment.beneficiary_id);
    if (!beneficiary.active || beneficiary.version !== payment.account_version)
      throw createError(409, "Cadastro ou conta alterados. Cancele este rascunho e prepare o pagamento novamente.");
    if (beneficiary.employee_id) {
      const employee = await tx.employees.findUnique({ where: { id: beneficiary.employee_id } });
      if (!employee || employee.name !== beneficiary.name || digits(employee.cpf) !== beneficiary.document)
        throw createError(409, "O cadastro do funcionário mudou. Revise o favorecido.");
    }
    if (beneficiary.vendor_id) {
      const vendor = await tx.vendors.findUnique({ where: { id: beneficiary.vendor_id } });
      if (!vendor || vendor.name !== beneficiary.name || digits(vendor.cnpj) !== beneficiary.document)
        throw createError(409, "O cadastro do fornecedor mudou. Revise o favorecido.");
    }
  }
  private async checkAllocations(tx: Tx, payment: BankPayment) {
    const allocations = await tx.bankPaymentAllocation.findMany({ where: { payment_id: payment.id } });
    for (const allocation of allocations) {
      const payable = await this.findPayable(tx, allocation.payable_id);
      const balance = payableBalance(payable.total_cents, payable.allocations);
      if (
        payable.status !== "APPROVED" ||
        payable.beneficiary_id !== payment.beneficiary_id ||
        payable.purpose !== payment.purpose ||
        balance.paid_cents + balance.reserved_cents > payable.total_cents
      ) {
        throw createError(
          409,
          "O saldo ou a solicitação mudou. Cancele esta instrução e confira as parcelas antes de preparar outro pagamento."
        );
      }
    }
  }
  async paymentAction(id: string, action: "release" | "cancel" | "retry", body: unknown, userId: number) {
    const { version } = await validateBody(versionSchema, body);
    await this.write(async (tx) => {
      const row = await this.findPayment(tx, id);
      if (row.version !== version) throw createError(409, "O pagamento mudou. Atualize a página antes de continuar.");
      if (action === "cancel") {
        if (!["DRAFT", "QUEUED", "FAILED"].includes(row.status))
          throw createError(
            409,
            "Somente instruções ainda não enviadas ou com falha definitiva podem ser canceladas aqui."
          );
      } else {
        if (row.status !== (action === "retry" ? "FAILED" : "DRAFT"))
          throw createError(409, "O pagamento não está disponível para esta ação.");
        const context = this.cora.context();
        if (!context.transfersEnabled || !context.workerEnabled)
          throw createError(503, "Envio de transferências desabilitado na API.");
        if (dateOnly(row.payment_date) < dateInSaoPaulo(this.now()))
          throw createError(400, "A data venceu. Cancele este pagamento e prepare outro com a data correta.");
        await this.checkDestination(tx, row);
        await this.checkAllocations(tx, row);
      }
      await tx.bankPayment.update({
        where: { id },
        data: { status: action === "cancel" ? "CANCELLED" : "QUEUED", version: { increment: 1 }, last_error: null }
      });
      await this.audit(tx, `PAYMENT_${action.toUpperCase()}`, id, userId);
    });
    return this.payment(id);
  }
  private payload(payment: BankPayment): TransferPayload {
    return {
      destination: payment.destination as Destination,
      amount: payment.amount_cents,
      code: payment.id,
      description: `${purposeLabels[payment.purpose]} ${payment.id}`,
      scheduled: dateOnly(payment.payment_date)
    };
  }
  async dispatch(id: string) {
    const context = this.cora.context();
    if (!context.configured || !context.transfersEnabled || !context.workerEnabled) return;
    const claimed = await this.write(async (tx) => {
      const row = await this.findPayment(tx, id);
      if (row.status !== "QUEUED") return null;
      try {
        if (dateOnly(row.payment_date) < dateInSaoPaulo(this.now()))
          throw createError(400, "Data de pagamento vencida. Cancele e prepare outra instrução.");
        await this.checkDestination(tx, row);
        await this.checkAllocations(tx, row);
      } catch (error) {
        const failed = await tx.bankPayment.update({
          where: { id },
          data: { status: "FAILED", last_error: (error as Error).message, version: { increment: 1 } }
        });
        await recordPaymentNotification(tx, failed, this.now());
        await this.audit(tx, "PAYMENT_VALIDATION_FAILED", id, null);
        return null;
      }
      await this.audit(tx, "PAYMENT_SUBMISSION_STARTED", id, null);
      return tx.bankPayment.update({
        where: { id },
        data: {
          status: "SUBMITTING",
          attempts: { increment: 1 },
          lease_until: new Date(this.now().getTime() + 120000),
          version: { increment: 1 }
        }
      });
    });
    if (!claimed) return;
    try {
      await this.applyRemote(id, await this.cora.initiateTransfer(this.payload(claimed), claimed.idempotency_key));
    } catch (error) {
      const failure = error instanceof CoraError ? error : new CoraError(true, false);
      await this.write(async (tx) => {
        const row = await this.findPayment(tx, id);
        if (row.status !== "SUBMITTING") return;
        const updated = await tx.bankPayment.update({
          where: { id },
          data: {
            status: failure.uncertain ? "UNKNOWN" : failure.retryable ? "FAILED" : "REJECTED",
            last_error: failure.message,
            lease_until: null,
            version: { increment: 1 }
          }
        });
        await recordPaymentNotification(tx, updated, this.now());
        await this.audit(tx, "PAYMENT_SUBMISSION_RESULT", id, null, { status: updated.status });
      });
    }
  }
  async applyRemote(id: string, remote: RemoteTransfer) {
    await this.write(async (tx) => {
      const row = await this.findPayment(tx, id);
      if (!row.attempts) return;
      if (!matchesTransfer(this.payload(row), remote, row.remote_id)) {
        if (!["COMPLETED", "REFUNDED"].includes(row.status)) {
          const updated = await tx.bankPayment.update({
            where: { id },
            data: {
              status: "UNKNOWN",
              lease_until: null,
              last_error: "O retorno bancário não confere com esta instrução. Consulte a Cora.",
              version: { increment: 1 }
            }
          });
          await recordPaymentNotification(tx, updated, this.now());
        }
        await this.audit(tx, "PAYMENT_RESPONSE_MISMATCH", id, null);
        return;
      }
      const status = nextStatus(row.status, normalizeStatus(remote.status));
      const updated = await tx.bankPayment.update({
        where: { id },
        data: {
          status,
          remote_id: remote.id,
          remote_status: remote.status.slice(0, 100),
          lease_until: null,
          last_checked_at: this.now(),
          submitted_at: row.submitted_at ?? this.now(),
          completed_at: status === "COMPLETED" ? row.completed_at ?? this.now() : row.completed_at,
          refunded_at: status === "REFUNDED" ? row.refunded_at ?? this.now() : row.refunded_at,
          last_error: status === "UNKNOWN" ? "Status bancário não reconhecido. Consulte a Cora." : null,
          version: status === row.status && row.remote_id === remote.id ? row.version : { increment: 1 }
        }
      });
      await recordPaymentNotification(tx, updated, this.now());
      if (status !== row.status || row.remote_id !== remote.id)
        await this.audit(tx, "PAYMENT_BANK_STATUS", id, null, { status, remote_id: remote.id });
      // Existing expense remains the single cost record; allocations represent its settlement only.
    });
  }
  async sync(id: string, userId: number | null = null) {
    const row = await this.findPayment(this.db, id);
    if (!row.attempts) return { payment: await this.payment(id), warnings: [] };
    const warnings: string[] = [];
    for (const status of ["INITIATED", "SCHEDULED", "COMPLETED", "CANCELLED", "REFUNDED"]) {
      try {
        for (let page = 0; page < 100; page++) {
          const result = await this.cora.transfers(
            status,
            dateInSaoPaulo(new Date(row.created_at.getTime() - 86400000)),
            dateInSaoPaulo(new Date(this.now().getTime() + 86400000)),
            page
          );
          for (const remote of result.content)
            if (remote.code === row.id || (row.remote_id && remote.id === row.remote_id))
              await this.applyRemote(id, remote);
          if (!result.hasMore) break;
          if (page === 99) warnings.push(`Consulta ${status} atingiu o limite de páginas.`);
        }
      } catch {
        warnings.push(`Não foi possível consultar ${status} na Cora.`);
      }
    }
    if (!warnings.length) {
      await this.db.bankPayment.updateMany({ where: { id, ...this.scope() }, data: { last_checked_at: this.now() } });
      if (row.remote_id)
        await this.db.bankWebhookEvent.updateMany({
          where: { ...this.scope(), resource_id: row.remote_id, processed_at: null },
          data: { processed_at: this.now() }
        });
    }
    if (userId) await this.audit(this.db, "PAYMENT_SYNC_REQUESTED", id, userId, { warnings });
    return { payment: await this.payment(id), warnings };
  }
  async tick() {
    const context = this.cora.context();
    if (!context.configured || !context.workerEnabled) return;
    const expired = await this.db.bankPayment.findMany({
      where: { ...this.scope(), status: "SUBMITTING", lease_until: { lt: this.now() } },
      take: 100
    });
    for (const row of expired)
      await this.write(async (tx) => {
        const current = await this.findPayment(tx, row.id);
        if (current.status !== "SUBMITTING" || !current.lease_until || current.lease_until >= this.now()) return;
        const updated = await tx.bankPayment.update({
          where: { id: row.id },
          data: {
            status: "UNKNOWN",
            lease_until: null,
            last_error: "Envio interrompido. Consulte a Cora antes de qualquer nova instrução.",
            version: { increment: 1 }
          }
        });
        await recordPaymentNotification(tx, updated, this.now());
        await this.audit(tx, "PAYMENT_LEASE_EXPIRED", row.id, null);
      });
    if (context.transfersEnabled) {
      const queued = await this.db.bankPayment.findMany({
        where: { ...this.scope(), status: "QUEUED" },
        orderBy: { created_at: "asc" },
        take: 10
      });
      for (const row of queued) await this.dispatch(row.id);
    }
    const pendingEvents = await this.db.bankWebhookEvent.findMany({
      where: { ...this.scope(), processed_at: null },
      take: 100
    });
    const due = await this.db.bankPayment.findMany({
      where: {
        ...this.scope(),
        attempts: { gt: 0 },
        OR: [
          { remote_id: { in: pendingEvents.map((event) => event.resource_id) } },
          {
            AND: [
              { OR: [{ last_checked_at: null }, { last_checked_at: { lt: new Date(this.now().getTime() - 300000) } }] },
              {
                OR: [
                  { status: { in: ["INITIATED", "SCHEDULED", "UNKNOWN"] } },
                  { status: "COMPLETED", completed_at: { gte: new Date(this.now().getTime() - 30 * 86400000) } }
                ]
              }
            ]
          }
        ]
      },
      orderBy: { updated_at: "asc" },
      take: 10
    });
    for (const row of due) {
      try {
        await this.sync(row.id);
      } catch {
        /* Consult again without resending. */
      }
    }
  }
}
