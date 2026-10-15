import { BankEnvironment, Prisma, PrismaClient } from "@prisma/client";
import createError from "http-errors";
import { HttpCoraGateway } from "@pontalti/integrations/cora/client";
import { digest, document, environment, integer, lock, money, PurchaseSnapshot, snapshot, text, uuid } from "./domain";

type DB = Prisma.TransactionClient;
export class CustomerFinanceService {
  constructor(
    public readonly db: PrismaClient,
    public readonly cora = new HttpCoraGateway()
  ) {}

  private async customer(db: DB, id: number) {
    const row = await db.customers.findUnique({ where: { id } });
    if (!row) throw createError(404, "Cliente não encontrado.");
    return row;
  }

  async summary(customerId: number, env: BankEnvironment, db?: DB) {
    if (!db)
      return this.db.$transaction(async (tx) => {
        await lock(tx);
        return this.summary(customerId, env, tx);
      });
    const customer = await this.customer(db, customerId);
    const [entries, opening, reservations, revision, receivables] = await Promise.all([
      db.customerFinanceEntry.aggregate({
        where: { customer_id: customerId, environment: env },
        _sum: { amount_cents: true }
      }),
      db.customerFinanceEntry.findUnique({
        where: { entry_key: `opening:${env}:${customerId}` },
        select: { id: true, amount_cents: true }
      }),
      db.customerFinancePurchase.aggregate({
        where: { customer_id: customerId, environment: env, status: "PENDING" },
        _sum: { reserved_cents: true }
      }),
      db.customerFinanceRevision.findUnique({
        where: { customer_id_environment: { customer_id: customerId, environment: env } }
      }),
      db.customerFinancePurchase.aggregate({
        where: { customer_id: customerId, environment: env, status: "APPROVED" },
        _sum: { amount_cents: true, cash_applied_cents: true }
      })
    ]);
    const balance =
      (entries._sum.amount_cents ?? 0) - (!opening && env === "PRODUCTION" ? Math.round(customer.debts * 100) : 0);
    const openingDebt =
      env === "PRODUCTION" ? Math.max(0, opening ? -opening.amount_cents : Math.round(customer.debts * 100)) : 0;
    const purchaseDebt = (receivables._sum.amount_cents ?? 0) - (receivables._sum.cash_applied_cents ?? 0);
    return {
      customer_id: customerId,
      name: customer.name,
      environment: env,
      balance_cents: balance,
      opening_debts_cents: openingDebt,
      legacy_debt_unallocated_cents: Math.max(0, -balance - purchaseDebt),
      legacy_debt_review_required: openingDebt > 0 && Math.max(0, -balance - purchaseDebt) > 0,
      reserved_cents: reservations._sum.reserved_cents ?? 0,
      available_cents: balance - (reservations._sum.reserved_cents ?? 0),
      debts_cents: Math.max(0, -balance),
      credit_limit_cents: Math.round(customer.credit_limit * 100),
      account_revision: revision?.revision ?? 0
    };
  }

  private async opening(db: DB, customerId: number, env: BankEnvironment) {
    const customer = await this.customer(db, customerId);
    await db.customerFinanceEntry.upsert({
      where: { entry_key: `opening:${env}:${customerId}` },
      update: {},
      create: {
        customer_id: customerId,
        environment: env,
        entry_key: `opening:${env}:${customerId}`,
        kind: "OPENING",
        amount_cents: env === "PRODUCTION" ? -Math.round(customer.debts * 100) : 0,
        description:
          env === "PRODUCTION" ? "Abertura dos débitos existentes no cadastro do cliente" : "Abertura isolada de testes"
      }
    });
  }
  private async bump(db: DB, customerId: number, env: BankEnvironment) {
    await db.customerFinanceRevision.upsert({
      where: { customer_id_environment: { customer_id: customerId, environment: env } },
      create: { customer_id: customerId, environment: env, revision: 1 },
      update: { revision: { increment: 1 } }
    });
    if (env === "PRODUCTION") {
      const balance = await this.summary(customerId, env, db);
      await db.customers.update({
        where: { id: customerId },
        data: { debts: balance.debts_cents / 100, updated_at: new Date() }
      });
    }
  }
  private audit(
    db: DB,
    action: string,
    resourceId: string,
    userId: number | null,
    reason: string | null,
    details: object = {}
  ) {
    return db.financialAuditEvent.create({
      data: {
        action,
        resource_id: resourceId,
        user_id: userId,
        details: { reason, ...details } as Prisma.InputJsonValue
      }
    });
  }
  private async approvedLink(db: DB, external: string, env: BankEnvironment) {
    const link = await db.customerFinanceLink.findUnique({
      where: { external_customer_id_environment: { external_customer_id: external, environment: env } }
    });
    if (!link || link.status !== "APPROVED")
      throw createError(
        403,
        "O vínculo do cliente precisa ser aprovado pela Pontalti antes de consultar ou usar saldo.",
        { code: "LINK_PENDING" }
      );
    return link;
  }
  async linkResult(id: string, db: DB = this.db) {
    const row = await db.customerFinanceLink.findUnique({ where: { id } });
    if (!row) throw createError(404, "Vínculo não encontrado.");
    return {
      ...row,
      ...(row.status === "APPROVED"
        ? { summary: await this.summary(row.customer_id, row.environment, db === this.db ? undefined : db) }
        : {})
    };
  }
  async link(data: any) {
    const external = uuid(data.external_customer_id),
      env = environment(data.environment);
    const doc = document(data.document),
      name = text(data.name, 120);
    const email = data.email ? text(data.email, 150) : undefined;
    return this.db.$transaction(async (db) => {
      await lock(db);
      const known = await db.customerFinanceLink.findUnique({
        where: { external_customer_id_environment: { external_customer_id: external, environment: env } }
      });
      if (known) {
        if (known.document !== doc)
          throw createError(409, "O CPF/CNPJ não corresponde ao vínculo existente. Solicite revisão à Pontalti.");
        return this.linkResult(known.id, db);
      }
      const rows = await db.$queryRaw<
        Array<{ id: number }>
      >`SELECT id FROM "Customers" WHERE regexp_replace(COALESCE(cpf,''), '[^0-9]', '', 'g') = ${doc} OR regexp_replace(COALESCE(cnpj,''), '[^0-9]', '', 'g') = ${doc}`;
      if (rows.length > 1)
        throw createError(409, "Há cadastros duplicados para este documento. A Pontalti precisa revisar o cadastro.");
      let customerId = rows[0]?.id;
      const existing = !!customerId;
      if (!customerId) {
        if (env === "STAGE" && this.cora.context().environment === "PRODUCTION")
          throw createError(409, "Um teste não pode criar clientes no cadastro de produção.");
        const address = data.address ?? {};
        const customer = await db.customers.create({
          data: {
            name,
            status: 1,
            credit_limit: 0,
            debts: 0,
            store_name: name,
            deliver: false,
            pontalti: false,
            secondary_line: false,
            ...(doc.length === 11 ? { cpf: doc } : { cnpj: doc }),
            updated_at: new Date(),
            // Never adopt another customer's email, which is not proof of identity either.
            ...(email && !(await db.customers.findUnique({ where: { email } })) ? { email } : {}),
            address: {
              create: {
                zip_code: typeof address.zip_code === "string" ? address.zip_code.slice(0, 10) : "",
                neighborhood: typeof address.neighborhood === "string" ? address.neighborhood.slice(0, 120) : "",
                public_place: typeof address.public_place === "string" ? address.public_place.slice(0, 150) : "",
                city: typeof address.city === "string" ? address.city.slice(0, 120) : "",
                state: typeof address.state === "string" ? address.state.slice(0, 2) : "",
                address_number:
                  Number.isSafeInteger(address.address_number) && address.address_number >= 0
                    ? address.address_number
                    : 0,
                complement: typeof address.complement === "string" ? address.complement.slice(0, 150) : null
              }
            }
          }
        });
        customerId = customer.id;
      }
      const created = await db.customerFinanceLink.create({
        data: {
          customer_id: customerId,
          external_customer_id: external,
          environment: env,
          name,
          document: doc,
          status: existing ? "PENDING" : "APPROVED"
        }
      });
      await this.audit(db, existing ? "CUSTOMER_LINK_REQUESTED" : "CUSTOMER_LINK_CREATED", created.id, null, null, {
        environment: env,
        customer_id: customerId
      });
      return this.linkResult(created.id, db);
    });
  }
  async externalLink(external: string, env: BankEnvironment) {
    const link = await this.db.customerFinanceLink.findUnique({
      where: { external_customer_id_environment: { external_customer_id: external, environment: env } }
    });
    if (!link) throw createError(404, "Vínculo não encontrado.");
    return this.linkResult(link.id);
  }
  async externalSummary(external: string, env: BankEnvironment) {
    const link = await this.approvedLink(this.db, external, env);
    return this.summary(link.customer_id, env);
  }
  async links(env: BankEnvironment, status?: string) {
    return this.db.customerFinanceLink.findMany({
      where: { environment: env, ...(status ? { status } : {}) },
      include: { customer: { select: { id: true, name: true, cpf: true, cnpj: true, email: true } } },
      orderBy: { created_at: "desc" },
      take: 200
    });
  }
  async reviewLink(id: string, action: "approve" | "reject", data: any, userId: number) {
    const version = integer(data.version),
      reason = text(data.reason, 1000);
    return this.db.$transaction(async (db) => {
      await lock(db);
      const link = await db.customerFinanceLink.findUnique({ where: { id } });
      if (!link) throw createError(404, "Vínculo não encontrado.");
      if (link.version !== version || link.status !== "PENDING")
        throw createError(409, "O vínculo foi alterado. Atualize a página.");
      if (action === "approve") {
        const owner = await this.customer(db, link.customer_id);
        if (String(owner.cpf ?? owner.cnpj ?? "").replace(/\D/g, "") !== link.document)
          throw createError(409, "O documento do cadastro mudou. Revise o vínculo antes de aprová-lo.");
        const other = await db.customerFinanceLink.findFirst({
          where: { customer_id: link.customer_id, environment: link.environment, status: "APPROVED", id: { not: id } }
        });
        if (other)
          throw createError(
            409,
            "Este cliente já possui outro vínculo aprovado neste ambiente. Revise a identidade antes de transferir o acesso."
          );
      }
      await db.customerFinanceLink.update({
        where: { id },
        data: { status: action === "approve" ? "APPROVED" : "REJECTED", version: { increment: 1 } }
      });
      await this.audit(
        db,
        action === "approve" ? "CUSTOMER_LINK_APPROVED" : "CUSTOMER_LINK_REJECTED",
        id,
        userId,
        reason
      );
      return this.linkResult(id, db);
    });
  }
  async customers(env: BankEnvironment) {
    const rows = await this.db.customers.findMany({ orderBy: { name: "asc" }, take: 500, select: { id: true } });
    const result = [];
    for (const row of rows) result.push(await this.summary(row.id, env));
    return result;
  }
  async statement(customerId: number, env: BankEnvironment) {
    await this.customer(this.db, customerId);
    return this.db.customerFinanceEntry.findMany({
      where: { customer_id: customerId, environment: env },
      orderBy: { created_at: "desc" },
      take: 200
    });
  }
  async externalStatement(external: string, env: BankEnvironment) {
    return this.statement((await this.approvedLink(this.db, external, env)).customer_id, env);
  }
  async purchase(id: string, db?: DB) {
    if (!db)
      return this.db.$transaction(async (tx) => {
        await lock(tx);
        return this.purchase(id, tx);
      });
    const row = await db.customerFinancePurchase.findUnique({
      where: { id },
      include: { customer: { select: { id: true, name: true, cpf: true, cnpj: true } } }
    });
    if (!row) throw createError(404, "Solicitação não encontrada.");
    const events = await db.financialAuditEvent.findMany({
      where: { resource_id: id },
      orderBy: { created_at: "asc" }
    });
    return {
      ...row,
      summary: await this.summary(row.customer_id, row.environment, db === this.db ? undefined : db),
      audit: events.map((event) => ({
        id: event.id,
        action: event.action,
        reason: (event.details as any)?.reason ?? null,
        user_id: event.user_id,
        created_at: event.created_at
      }))
    };
  }
  async purchases(env: BankEnvironment, status?: string) {
    const rows = await this.db.customerFinancePurchase.findMany({
      where: { environment: env, ...(status ? { status } : {}) },
      orderBy: { created_at: "desc" },
      take: 200
    });
    const result = [];
    for (const row of rows) result.push(await this.purchase(row.id));
    return result;
  }
  async purchaseByOrder(externalOrder: string, env: BankEnvironment) {
    const row = await this.db.customerFinancePurchase.findUnique({
      where: { external_order_id_environment: { external_order_id: externalOrder, environment: env } }
    });
    if (!row) throw createError(404, "Solicitação não encontrada.");
    return this.purchase(row.id);
  }
  private async commitPurchase(db: DB, purchase: any, userId: number | null, reason: string | null) {
    const summary = await this.summary(purchase.customer_id, purchase.environment, db);
    const spendable = summary.available_cents + (purchase.status === "PENDING" ? purchase.reserved_cents : 0);
    const otherReservations = summary.reserved_cents - (purchase.status === "PENDING" ? purchase.reserved_cents : 0);
    if (otherReservations > 0 && summary.balance_cents - purchase.amount_cents < otherReservations) {
      throw createError(409, "Resolva primeiro os outros pedidos que reservaram saldo deste cliente.");
    }
    if (spendable - purchase.amount_cents < purchase.consented_projected_balance_cents) {
      throw createError(
        409,
        "O saldo previsto ficou pior que o aceito pelo cliente. Solicite uma nova confirmação antes de continuar."
      );
    }
    const cash = Math.min(purchase.amount_cents, Math.max(0, spendable));
    await db.customerFinanceEntry.create({
      data: {
        customer_id: purchase.customer_id,
        environment: purchase.environment,
        entry_key: `purchase:${purchase.id}`,
        kind: "PURCHASE",
        amount_cents: -purchase.amount_cents,
        purchase_id: purchase.id,
        description: `Compra com saldo na conta (${purchase.external_order_id})`
      }
    });
    await db.customerFinancePurchase.update({
      where: { id: purchase.id },
      data: {
        status: "APPROVED",
        reserved_cents: 0,
        cash_applied_cents: cash,
        balance_before_cents: summary.balance_cents,
        projected_balance_cents: spendable - purchase.amount_cents,
        reason,
        reviewed_by: userId,
        reviewed_at: new Date(),
        version: { increment: 1 }
      }
    });
    await this.bump(db, purchase.customer_id, purchase.environment);
    await this.audit(
      db,
      userId ? "CUSTOMER_PURCHASE_APPROVED" : "CUSTOMER_PURCHASE_FUNDED",
      purchase.id,
      userId,
      reason,
      {
        cash_applied_cents: cash,
        amount_cents: purchase.amount_cents,
        resulting_debt_cents: Math.max(0, purchase.amount_cents - spendable)
      }
    );
  }
  async createPurchase(data: any) {
    const external = uuid(data.external_customer_id),
      externalOrder = uuid(data.external_order_id),
      env = environment(data.environment);
    const idempotency = uuid(data.idempotency_key),
      amount = money(data.amount_cents),
      orderSnapshot = snapshot(data.order_snapshot, amount);
    const hash = digest({ external, externalOrder, env, amount, orderSnapshot });
    return this.db.$transaction(async (db) => {
      await lock(db);
      const known = await db.customerFinancePurchase.findFirst({
        where: { OR: [{ idempotency_key: idempotency }, { external_order_id: externalOrder, environment: env }] }
      });
      if (known) {
        if (known.request_hash !== hash) throw createError(409, "A referência já foi usada com dados diferentes.");
        return this.purchase(known.id, db);
      }
      const link = await this.approvedLink(db, external, env);
      await this.opening(db, link.customer_id, env);
      const summary = await this.summary(link.customer_id, env, db);
      if (
        data.expected_account_revision !== summary.account_revision ||
        data.expected_projected_balance_cents !== summary.available_cents - amount
      ) {
        throw createError(409, "O saldo mudou desde a confirmação. Confira novamente os valores com o cliente.", {
          code: "ACCOUNT_CHANGED"
        });
      }
      const requiresApproval = summary.available_cents - amount < 0;
      const row = await db.customerFinancePurchase.create({
        data: {
          customer_id: link.customer_id,
          external_customer_id: external,
          external_order_id: externalOrder,
          environment: env,
          idempotency_key: idempotency,
          request_hash: hash,
          amount_cents: amount,
          reserved_cents: requiresApproval ? Math.min(amount, Math.max(0, summary.available_cents)) : 0,
          balance_before_cents: summary.balance_cents,
          projected_balance_cents: summary.available_cents - amount,
          consented_projected_balance_cents: summary.available_cents - amount,
          requires_approval: requiresApproval,
          order_snapshot: orderSnapshot as unknown as Prisma.InputJsonValue
        }
      });
      if (!requiresApproval) await this.commitPurchase(db, row, null, null);
      else {
        await this.bump(db, link.customer_id, env);
        await this.audit(db, "CUSTOMER_PURCHASE_REQUESTED", row.id, null, null, {
          amount_cents: amount,
          reserved_cents: row.reserved_cents
        });
      }
      return this.purchase(row.id, db);
    });
  }
  async reviewPurchase(id: string, action: "approve" | "reject", data: any, userId: number) {
    const version = integer(data.version),
      reason = text(data.reason, 1000);
    return this.db.$transaction(async (db) => {
      await lock(db);
      const purchase = await db.customerFinancePurchase.findUnique({ where: { id } });
      if (!purchase) throw createError(404, "Solicitação não encontrada.");
      if (purchase.version !== version || purchase.status !== "PENDING")
        throw createError(409, "A solicitação foi alterada. Atualize a página.");
      const summary = await this.summary(purchase.customer_id, purchase.environment, db);
      if (action === "approve") {
        if (data.account_revision !== summary.account_revision)
          throw createError(
            409,
            "O saldo ou as reservas mudaram desde a conferência. Atualize os valores antes de aprovar."
          );
        await this.approvedLink(db, purchase.external_customer_id, purchase.environment);
        await this.commitPurchase(db, purchase, userId, reason);
      } else {
        await db.customerFinancePurchase.update({
          where: { id },
          data: {
            status: "REJECTED",
            reserved_cents: 0,
            reason,
            reviewed_by: userId,
            reviewed_at: new Date(),
            version: { increment: 1 }
          }
        });
        await this.bump(db, purchase.customer_id, purchase.environment);
        await this.audit(db, "CUSTOMER_PURCHASE_REJECTED", id, userId, reason);
      }
      return this.purchase(id, db);
    });
  }
  async renewConsent(id: string, data: any, env: BankEnvironment) {
    const version = integer(data.version);
    return this.db.$transaction(async (db) => {
      await lock(db);
      const purchase = await db.customerFinancePurchase.findUnique({ where: { id } });
      if (!purchase || purchase.environment !== env) throw createError(404, "Solicitação não encontrada.");
      if (purchase.status !== "PENDING" || purchase.version !== version)
        throw createError(409, "A solicitação foi alterada. Confira o estado atual antes de confirmar novamente.");
      await this.approvedLink(db, purchase.external_customer_id, env);
      const summary = await this.summary(purchase.customer_id, env, db);
      const spendable = summary.available_cents + purchase.reserved_cents;
      const projected = spendable - purchase.amount_cents;
      if (
        data.expected_account_revision !== summary.account_revision ||
        data.expected_projected_balance_cents !== projected
      ) {
        throw createError(409, "O saldo mudou desde a confirmação. Confira novamente os valores com o cliente.", {
          code: "ACCOUNT_CHANGED"
        });
      }
      const updated = await db.customerFinancePurchase.update({
        where: { id },
        data: {
          consented_projected_balance_cents: projected,
          balance_before_cents: summary.balance_cents,
          projected_balance_cents: projected,
          reserved_cents: Math.min(purchase.amount_cents, Math.max(0, spendable)),
          requires_approval: projected < 0,
          version: { increment: 1 }
        }
      });
      await this.audit(db, "CUSTOMER_PURCHASE_CONSENT_RENEWED", id, null, null, {
        previous_projected_cents: purchase.consented_projected_balance_cents,
        consented_projected_balance_cents: projected,
        account_revision: summary.account_revision
      });
      if (projected >= 0) await this.commitPurchase(db, updated, null, null);
      else await this.bump(db, purchase.customer_id, env);
      return this.purchase(id, db);
    });
  }
  async cancelPurchase(id: string, data: any, env?: BankEnvironment, userId: number | null = null) {
    const version = integer(data.version),
      reason = data.reason ? text(data.reason, 1000) : "Cancelamento solicitado pelo cliente";
    return this.db.$transaction(async (db) => {
      await lock(db);
      const purchase = await db.customerFinancePurchase.findUnique({ where: { id } });
      if (!purchase || (env && purchase.environment !== env)) throw createError(404, "Solicitação não encontrada.");
      if (purchase.status === "CANCELLED") return this.purchase(id, db);
      if (purchase.version !== version) throw createError(409, "A solicitação foi alterada. Atualize a página.");
      if (purchase.core_order_id)
        throw createError(409, "O pedido já está na fábrica. Solicite o cancelamento à Pontalti.");
      if (!["PENDING", "APPROVED"].includes(purchase.status))
        throw createError(409, "A solicitação não pode ser cancelada.");
      if (purchase.status === "APPROVED")
        await db.customerFinanceEntry.create({
          data: {
            customer_id: purchase.customer_id,
            environment: purchase.environment,
            entry_key: `cancel:${id}`,
            kind: "PURCHASE_REFUND",
            amount_cents: purchase.amount_cents,
            purchase_id: id,
            description: "Devolução de compra cancelada antes do registro na fábrica"
          }
        });
      await db.customerFinancePurchase.update({
        where: { id },
        data: {
          status: "CANCELLED",
          reserved_cents: 0,
          version: { increment: 1 },
          reason,
          reviewed_by: userId,
          reviewed_at: new Date()
        }
      });
      await this.bump(db, purchase.customer_id, purchase.environment);
      await this.audit(db, "CUSTOMER_PURCHASE_CANCELLED", id, userId, reason);
      return this.purchase(id, db);
    });
  }
  private coreProducts(purchase: any, supplied?: any[]) {
    const saved = purchase.order_snapshot as PurchaseSnapshot;
    const products = saved.items.map((item, index) => {
      const input = supplied?.[index];
      const id = item.product_id ?? input?.id;
      if (!id)
        throw createError(409, "Vincule os produtos da loja aos produtos da fábrica antes de registrar o pedido.");
      if (
        input &&
        (input.id !== id ||
          input.quantity !== item.quantity ||
          Math.round(Number(input.unit_price) * 100) !== item.unit_price_cents)
      ) {
        throw createError(409, "Os produtos e os preços diferem da solicitação aprovada.");
      }
      return { id: integer(id), quantity: item.quantity, unit_price: item.unit_price_cents / 100 };
    });
    if (supplied && supplied.length !== products.length)
      throw createError(409, "Os produtos diferem da solicitação aprovada.");
    if (new Set(products.map((item) => item.id)).size !== products.length)
      throw createError(409, "Agrupe os itens repetidos do pedido antes de registrar na fábrica.");
    return products;
  }
  private async applyOrder(db: DB, purchase: any, coreOrderId: number, userId: number | null) {
    const order = await db.orders.findUnique({
      where: { id: coreOrderId },
      include: { products: true, payments: true }
    });
    if (
      !order ||
      order.customer_id !== purchase.customer_id ||
      Math.round(order.final_price * 100) !== purchase.amount_cents ||
      order.status === 5
    ) {
      throw createError(409, "Cliente, valor ou situação do pedido não corresponde à solicitação aprovada.");
    }
    const products = this.coreProducts(purchase);
    if (
      products.length !== order.products.length ||
      products.some(
        (item) =>
          !order.products.some(
            (other) =>
              other.product_id === item.id &&
              other.quantity === item.quantity &&
              Math.round(other.unit_price * 100) === Math.round(item.unit_price * 100)
          )
      )
    ) {
      throw createError(409, "Os produtos registrados diferem da solicitação aprovada.");
    }
    if (order.payments.length)
      throw createError(409, "O pedido já possui pagamentos. Revise antes de vincular o saldo.");
    // Applied prepayment is accounted for as already received money. Credit approval is not a cash receipt.
    if (purchase.cash_applied_cents > 0)
      await db.payments.create({
        data: {
          order_id: coreOrderId,
          amount_paid: purchase.cash_applied_cents / 100,
          remaining: (purchase.amount_cents - purchase.cash_applied_cents) / 100,
          payment_method: "Saldo na conta (depósito confirmado)",
          date: new Date()
        }
      });
    await db.customerFinancePurchase.update({
      where: { id: purchase.id },
      data: { core_order_id: coreOrderId, version: { increment: 1 } }
    });
    await this.audit(db, "CUSTOMER_PURCHASE_REGISTERED", purchase.id, userId, null, {
      core_order_id: coreOrderId,
      cash_applied_cents: purchase.cash_applied_cents
    });
    return this.purchase(purchase.id, db);
  }
  async registerOrder(id: string, data: any, userId: number) {
    return this.db.$transaction(async (db) => {
      await lock(db);
      const purchase = await db.customerFinancePurchase.findUnique({ where: { id } });
      if (!purchase) throw createError(404, "Solicitação não encontrada.");
      if (purchase.status !== "APPROVED")
        throw createError(409, "A Pontalti ainda não aprovou a continuidade do pedido.");
      // Idempotent return even after a previous successful registration incremented its version.
      if (purchase.core_order_id) return this.purchase(id, db);
      if (purchase.environment !== "PRODUCTION")
        throw createError(409, "Pedidos de teste não podem ser registrados na fábrica de produção.");
      if (integer(data.version) !== purchase.version) throw createError(409, "A solicitação mudou. Atualize a página.");
      const products = this.coreProducts(purchase, data.products);
      const savedSnapshot = purchase.order_snapshot as unknown as PurchaseSnapshot;
      if (savedSnapshot.items.some((item) => !item.product_id)) {
        purchase.order_snapshot = {
          ...savedSnapshot,
          items: savedSnapshot.items.map((item, index) => ({ ...item, product_id: products[index].id }))
        };
        await db.customerFinancePurchase.update({ where: { id }, data: { order_snapshot: purchase.order_snapshot } });
      }
      const count = await db.products.count({ where: { id: { in: products.map((item) => item.id) }, status: 1 } });
      if (count !== products.length) throw createError(409, "Um dos produtos não está disponível na fábrica.");
      const customer = await db.customers.findUnique({
        where: { id: purchase.customer_id },
        include: { address: true }
      });
      const shippingAddress = savedSnapshot.address;
      if (
        shippingAddress &&
        !customer.address.public_place &&
        !customer.address.city &&
        !customer.address.zip_code &&
        typeof shippingAddress.public_place === "string" &&
        shippingAddress.public_place &&
        typeof shippingAddress.city === "string" &&
        shippingAddress.city &&
        typeof shippingAddress.state === "string" &&
        shippingAddress.state.length === 2 &&
        typeof shippingAddress.zip_code === "string" &&
        /^\d{8}$/.test(shippingAddress.zip_code.replace(/\D/g, ""))
      ) {
        const number = String(shippingAddress.address_number ?? "");
        await db.adresses.update({
          where: { id: customer.address_id },
          data: {
            public_place: shippingAddress.public_place,
            neighborhood: String(shippingAddress.neighborhood ?? ""),
            city: shippingAddress.city,
            state: shippingAddress.state,
            zip_code: shippingAddress.zip_code.replace(/\D/g, ""),
            complement: shippingAddress.complement === null ? null : String(shippingAddress.complement ?? ""),
            address_number: /^\d{1,8}$/.test(number) ? Number(number) : 0
          }
        });
        await this.audit(db, "CUSTOMER_EMPTY_ADDRESS_COMPLETED", id, userId, null, {
          source: "approved_order_snapshot"
        });
      }
      const order = await db.orders.create({
        data: {
          customer_id: purchase.customer_id,
          final_price: purchase.amount_cents / 100,
          discount: (purchase.order_snapshot as any).discount_cents / 100,
          date: new Date(),
          status: 1,
          products: {
            create: products.map((item) => ({
              product_id: item.id,
              quantity: item.quantity,
              unit_price: item.unit_price
            }))
          }
        }
      });
      return this.applyOrder(db, purchase, order.id, userId);
    });
  }
  async linkOrder(id: string, data: any, userId: number | null, env?: BankEnvironment) {
    const coreId = integer(data.core_order_id);
    return this.db.$transaction(async (db) => {
      await lock(db);
      const purchase = await db.customerFinancePurchase.findUnique({ where: { id } });
      if (!purchase || (env && purchase.environment !== env)) throw createError(404, "Solicitação não encontrada.");
      if (purchase.core_order_id === coreId) return this.purchase(id, db);
      if (purchase.core_order_id || purchase.status !== "APPROVED" || purchase.environment !== "PRODUCTION")
        throw createError(409, "O pedido não pode ser vinculado.");
      return this.applyOrder(db, purchase, coreId, userId);
    });
  }

  async externalDeposits(external: string, env: BankEnvironment) {
    await this.approvedLink(this.db, external, env);
    return this.db.customerFinanceDeposit.findMany({
      where: { external_customer_id: external, environment: env },
      orderBy: { created_at: "desc" },
      select: this.depositSelect(),
      take: 100
    });
  }
  private depositSelect() {
    return {
      id: true,
      customer_id: true,
      external_customer_id: true,
      environment: true,
      status: true,
      kind: true,
      version: true,
      amount_cents: true,
      deposited_at: true,
      reference: true,
      invoice_id: true,
      boleto_url: true,
      digitable: true,
      created_at: true,
      reason: true
    };
  }
  async deposit(id: string, env?: BankEnvironment, db: DB = this.db) {
    const row = await db.customerFinanceDeposit.findFirst({
      where: { id, ...(env ? { environment: env } : {}) },
      select: this.depositSelect()
    });
    if (!row) throw createError(404, "Depósito não encontrado.");
    return row;
  }
  async deposits(env: BankEnvironment, status?: string) {
    return this.db.customerFinanceDeposit.findMany({
      where: { environment: env, ...(status ? { status } : {}) },
      select: { ...this.depositSelect(), customer: { select: { id: true, name: true } }, bank_entry: true },
      orderBy: { created_at: "desc" },
      take: 200
    });
  }
  private assertBankEnvironment(env: BankEnvironment) {
    if (this.cora.context().environment !== env)
      throw createError(
        409,
        "O ambiente solicitado difere da conexão Cora. Não é permitido usar a conta de produção em um teste."
      );
  }
  async createDeposit(data: any, kind: "BOLETO" | "BANK_CLAIM") {
    const external = uuid(data.external_customer_id),
      env = environment(data.environment),
      amount = money(data.amount_cents),
      idempotency = uuid(data.idempotency_key);
    const depositedAt = kind === "BANK_CLAIM" ? new Date(data.deposited_at) : null;
    if (
      kind === "BANK_CLAIM" &&
      (!Number.isFinite(depositedAt.getTime()) || depositedAt.getTime() > Date.now() + 86400000)
    )
      throw createError(400, "Informe a data do depósito.");
    const reference = data.reference ? text(data.reference, 1000) : null;
    const hash = digest({ external, env, amount, kind, depositedAt, reference });
    const prepared = await this.db.$transaction(async (db) => {
      await lock(db);
      const known = await db.customerFinanceDeposit.findUnique({ where: { idempotency_key: idempotency } });
      if (known) {
        if (known.request_hash !== hash) throw createError(409, "A referência já foi usada com dados diferentes.");
        return { row: known, emit: false };
      }
      const link = await this.approvedLink(db, external, env);
      let payload: Prisma.InputJsonValue | undefined;
      if (kind === "BOLETO") {
        if (process.env.CORA_CUSTOMER_DEPOSITS_ENABLED !== "true")
          throw createError(
            503,
            "A emissão de boletos para adicionar saldo ainda não foi habilitada pela Pontalti. Informe um depósito já realizado para conferência."
          );
        this.assertBankEnvironment(env);
        if (amount < 500) throw createError(400, "O boleto deve ser de pelo menos R$ 5,00.");
        const customer = await this.customer(db, link.customer_id);
        const doc = document(customer.cpf ?? customer.cnpj);
        payload = {
          code: idempotency,
          customer: {
            name: customer.name.slice(0, 60),
            ...(customer.email ? { email: customer.email.slice(0, 60) } : {}),
            document: { identity: doc, type: doc.length === 11 ? "CPF" : "CNPJ" }
          },
          services: [{ name: "Adicionar saldo na Pontalti", amount }],
          payment_terms: { due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) },
          payment_forms: ["BANK_SLIP"]
        };
      }
      const created = await db.customerFinanceDeposit.create({
        data: {
          customer_id: link.customer_id,
          external_customer_id: external,
          environment: env,
          idempotency_key: idempotency,
          request_hash: hash,
          kind,
          amount_cents: amount,
          deposited_at: depositedAt,
          reference,
          ...(payload ? { invoice_payload: payload, status: "UNKNOWN" } : {})
        }
      });
      await this.audit(
        db,
        kind === "BOLETO" ? "CUSTOMER_TOPUP_REQUESTED" : "CUSTOMER_DEPOSIT_CLAIMED",
        created.id,
        null,
        null,
        { amount_cents: amount, environment: env }
      );
      return { row: created, emit: kind === "BOLETO" };
    });
    const row = prepared.row;
    if (prepared.emit) {
      // Stored, immutable body and UUID precede the only emission attempt. UNKNOWN never automatically resends.
      this.assertBankEnvironment(env);
      try {
        const invoice = await this.cora.createCustomerInvoice(row.invoice_payload, row.idempotency_key);
        if (invoice.code !== row.idempotency_key || invoice.total_amount !== row.amount_cents)
          throw createError(502, "A cobrança retornada não corresponde à solicitação.");
        await this.db.customerFinanceDeposit.update({
          where: { id: row.id },
          data: {
            invoice_id: invoice.id,
            status: "OPEN",
            boleto_url: invoice.payment_options?.bank_slip?.url ?? null,
            digitable: invoice.payment_options?.bank_slip?.digitable ?? null,
            version: { increment: 1 }
          }
        });
      } catch {
        await this.db.customerFinanceDeposit.update({
          where: { id: row.id },
          data: {
            status: "UNKNOWN",
            last_error: "Confira a emissão com a Cora antes de criar outra cobrança.",
            version: { increment: 1 }
          }
        });
      }
    }
    return this.deposit(row.id, env);
  }
  private async creditDeposit(db: DB, row: any, userId: number | null, reason: string | null, bankEntryId?: string) {
    await this.opening(db, row.customer_id, row.environment);
    const beforeCredit = await this.summary(row.customer_id, row.environment, db);
    await db.customerFinanceEntry.create({
      data: {
        customer_id: row.customer_id,
        environment: row.environment,
        entry_key: `deposit:${row.id}`,
        deposit_id: row.id,
        kind: "DEPOSIT",
        amount_cents: row.amount_cents,
        description: "Depósito confirmado na Cora"
      }
    });
    await db.customerFinanceDeposit.update({
      where: { id: row.id },
      data: {
        status: "CREDITED",
        ...(bankEntryId ? { bank_entry_id: bankEntryId } : {}),
        reason,
        version: { increment: 1 }
      }
    });
    // Allocate confirmed money against existing approved receivables. This keeps Payments.remaining
    // and Customers.debts aligned without counting a credit approval as a receipt.
    const receivables = await db.customerFinancePurchase.findMany({
      where: { customer_id: row.customer_id, environment: row.environment, status: "APPROVED" },
      orderBy: { created_at: "asc" }
    });
    const purchaseDebt = receivables.reduce(
      (sum, purchase) => sum + purchase.amount_cents - purchase.cash_applied_cents,
      0
    );
    const olderLegacyDebt = Math.max(0, beforeCredit.debts_cents - purchaseDebt);
    let toAllocate = Math.max(
      0,
      Math.min(row.amount_cents, beforeCredit.debts_cents) - Math.min(row.amount_cents, olderLegacyDebt)
    );
    for (const purchase of receivables) {
      const amount = Math.min(toAllocate, purchase.amount_cents - purchase.cash_applied_cents);
      if (amount <= 0) continue;
      await db.customerFinancePurchase.update({
        where: { id: purchase.id },
        data: { cash_applied_cents: { increment: amount }, version: { increment: 1 } }
      });
      if (purchase.core_order_id)
        await db.payments.create({
          data: {
            order_id: purchase.core_order_id,
            amount_paid: amount / 100,
            remaining: (purchase.amount_cents - purchase.cash_applied_cents - amount) / 100,
            payment_method: "Saldo na conta (depósito confirmado)",
            date: new Date()
          }
        });
      await this.audit(db, "CUSTOMER_DEPOSIT_ALLOCATED", purchase.id, userId, reason, {
        deposit_id: row.id,
        amount_cents: amount
      });
      toAllocate -= amount;
    }
    await this.bump(db, row.customer_id, row.environment);
    await this.audit(db, "CUSTOMER_DEPOSIT_CREDITED", row.id, userId, reason, {
      amount_cents: row.amount_cents,
      bank_entry_id: bankEntryId ?? null
    });
  }
  async syncDeposit(id: string, env?: BankEnvironment) {
    const row = await this.db.customerFinanceDeposit.findUnique({ where: { id } });
    if (!row || (env && row.environment !== env)) throw createError(404, "Depósito não encontrado.");
    if (!row.invoice_id || row.status === "CREDITED" || row.status === "REJECTED") return this.deposit(id);
    this.assertBankEnvironment(row.environment);
    const invoice = await this.cora.customerInvoice(row.invoice_id);
    if (
      invoice.id !== row.invoice_id ||
      invoice.code !== row.idempotency_key ||
      invoice.total_amount !== row.amount_cents
    ) {
      throw createError(502, "A cobrança consultada não corresponde ao depósito.");
    }
    if (invoice.status === "PAID" && invoice.total_paid === row.amount_cents)
      await this.db.$transaction(async (db) => {
        await lock(db);
        const current = await db.customerFinanceDeposit.findUnique({ where: { id } });
        if (current.status !== "CREDITED" && current.status !== "REJECTED")
          await this.creditDeposit(db, current, null, null);
      });
    return this.deposit(id);
  }
  async reviewDeposit(id: string, action: "confirm" | "reject", data: any, userId: number) {
    const version = integer(data.version),
      reason = text(data.reason, 1000);
    // Refresh the exact bank entry before trusting an old imported statement row.
    let imported: any;
    if (action === "confirm") {
      imported = await this.db.customerFinanceBankEntry.findUnique({ where: { id: uuid(data.bank_entry_id) } });
      if (!imported) throw createError(404, "Lançamento bancário não encontrado.");
      this.assertBankEnvironment(imported.environment);
      // Search adjacent UTC dates so neither bank endpoint inclusivity nor São Paulo's
      // date boundary can hide the exact receipt we must authenticate again.
      const occurredAt = imported.occurred_at.getTime();
      const start = new Date(occurredAt - 86400000).toISOString().slice(0, 10);
      const end = new Date(occurredAt + 86400000).toISOString().slice(0, 10);
      const refreshed = await this.syncBankEntries(start, end);
      if (!refreshed.seen_remote_ids.includes(imported.remote_id))
        throw createError(409, "O crédito não foi localizado na consulta atual ao banco. Nenhum saldo foi liberado.");
    }
    return this.db.$transaction(async (db) => {
      await lock(db);
      const row = await db.customerFinanceDeposit.findUnique({ where: { id } });
      if (!row) throw createError(404, "Depósito não encontrado.");
      if (row.status === "CREDITED") return this.deposit(id, undefined, db);
      if (row.version !== version || !["PENDING", "OPEN", "UNKNOWN"].includes(row.status))
        throw createError(409, "O depósito foi alterado. Atualize a página.");
      if (action === "reject") {
        if (row.kind === "BOLETO")
          throw createError(
            409,
            "Uma cobrança bancária emitida precisa ser cancelada no banco antes de encerrar a conferência."
          );
        await db.customerFinanceDeposit.update({
          where: { id },
          data: { status: "REJECTED", reason, version: { increment: 1 } }
        });
        await this.audit(db, "CUSTOMER_DEPOSIT_REJECTED", id, userId, reason);
      } else {
        if (row.kind !== "BANK_CLAIM")
          throw createError(409, "Boletos são creditados somente pela confirmação autenticada da cobrança.");
        const entry = await db.customerFinanceBankEntry.findUnique({
          where: { id: imported.id },
          include: { deposit: true }
        });
        if (
          !entry ||
          entry.type !== "CREDIT" ||
          entry.amount_cents !== row.amount_cents ||
          entry.environment !== row.environment ||
          entry.deposit ||
          entry.connection_key !== this.cora.context().connectionKey ||
          entry.authenticated_at.getTime() < Date.now() - 120000
        )
          throw createError(409, "O lançamento não é um crédito disponível e autenticado do mesmo valor e ambiente.");
        const alreadyCredited = await db.customerFinanceBankEntry.findFirst({
          where: { environment: row.environment, remote_id: entry.remote_id, deposit: { isNot: null } },
          select: { id: true }
        });
        if (alreadyCredited)
          throw createError(409, "Este recebimento do banco já gerou crédito, inclusive em uma conexão anterior.");
        // PAYMENT receives boleto money which must be reconciled by invoice, never credited again as a loose claim.
        if (entry.transaction_type !== "TRANSFER")
          throw createError(
            409,
            "Este lançamento exige conciliação da cobrança original para evitar crédito duplicado."
          );
        const dateDistance = Math.abs(entry.occurred_at.getTime() - row.deposited_at.getTime());
        if (dateDistance > 7 * 86400000)
          throw createError(409, "O lançamento está fora do período informado. Revise a solicitação.");
        await this.creditDeposit(db, row, userId, reason, entry.id);
      }
      return this.deposit(id, undefined, db);
    });
  }
  async bankEntries(env: BankEnvironment) {
    return this.db.customerFinanceBankEntry.findMany({
      where: { environment: env, type: "CREDIT", deposit: null },
      orderBy: { occurred_at: "desc" },
      take: 200
    });
  }
  async syncBankEntries(start: string, end: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
      !Number.isFinite(Date.parse(start)) ||
      !Number.isFinite(Date.parse(end)) ||
      end < start ||
      Date.parse(end) - Date.parse(start) > 90 * 86400000
    )
      throw createError(400, "Consulte até 90 dias por vez, com datas válidas.");
    const context = this.cora.context();
    let imported = 0;
    const seenRemoteIds: string[] = [];
    for (let page = 1; page <= 100; page++) {
      const response = (await this.cora.statement(start, end, page)) as any;
      if (!response || !(response.entries === null || Array.isArray(response.entries)))
        throw createError(502, "Extrato Cora não reconhecido.");
      const rows = response.entries ?? [];
      for (const entry of rows) {
        if (entry.type !== "CREDIT") continue;
        if (
          typeof entry.id !== "string" ||
          !entry.id ||
          entry.id.length > 200 ||
          !Number.isSafeInteger(entry.amount) ||
          entry.amount <= 0 ||
          entry.amount > 1_000_000_000 ||
          !Number.isFinite(Date.parse(entry.createdAt))
        ) {
          throw createError(502, "Crédito do extrato Cora em formato não reconhecido.");
        }
        const party = entry.transaction?.counterParty;
        const known = await this.db.customerFinanceBankEntry.findUnique({
          where: { connection_key_remote_id: { connection_key: context.connectionKey, remote_id: entry.id } }
        });
        if (
          known &&
          (known.amount_cents !== entry.amount ||
            known.type !== entry.type ||
            known.occurred_at.getTime() !== Date.parse(entry.createdAt) ||
            known.transaction_type !== (entry.transaction?.type ?? null) ||
            known.transaction_id !==
              (typeof entry.transaction?.id === "string" ? entry.transaction.id.slice(0, 200) : null) ||
            known.counterparty_document !==
              (typeof party?.identity === "string" ? party.identity.replace(/\D/g, "").slice(0, 14) : null) ||
            known.counterparty_name !== (typeof party?.name === "string" ? party.name.slice(0, 200) : null))
        ) {
          throw createError(
            502,
            "O banco retornou dados diferentes para um lançamento já importado. Revise a conciliação."
          );
        }
        await this.db.customerFinanceBankEntry.upsert({
          where: { connection_key_remote_id: { connection_key: context.connectionKey, remote_id: entry.id } },
          create: {
            connection_key: context.connectionKey,
            environment: context.environment,
            remote_id: entry.id,
            type: "CREDIT",
            amount_cents: entry.amount,
            occurred_at: new Date(entry.createdAt),
            counterparty_name: typeof party?.name === "string" ? party.name.slice(0, 200) : null,
            counterparty_document:
              typeof party?.identity === "string" ? party.identity.replace(/\D/g, "").slice(0, 14) : null,
            transaction_type: typeof entry.transaction?.type === "string" ? entry.transaction.type.slice(0, 100) : null,
            transaction_id: typeof entry.transaction?.id === "string" ? entry.transaction.id.slice(0, 200) : null,
            description:
              typeof entry.transaction?.description === "string" ? entry.transaction.description.slice(0, 500) : null
          },
          update: { authenticated_at: new Date() }
        });
        imported++;
        seenRemoteIds.push(entry.id);
      }
      if (rows.length < 100) return { imported, environment: context.environment, seen_remote_ids: seenRemoteIds };
    }
    throw createError(502, "Extrato excedeu o limite de páginas. Consulte um período menor.");
  }
  async tick() {
    const env = this.cora.context().environment;
    const pending = await this.db.customerFinanceDeposit.findMany({
      where: { environment: env, kind: "BOLETO", status: "OPEN" },
      take: 100
    });
    for (const row of pending) await this.syncDeposit(row.id, env);
    // Read-only import. Claims without an invoice always require explicit human review.
    await this.syncBankEntries(
      new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10)
    );
  }
}
