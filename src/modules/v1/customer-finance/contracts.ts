/** Shared JSON contract: all money is integer BRL cents, dates are ISO8601. */
export type FinanceEnvironment = "STAGE" | "PRODUCTION";
export type FinanceSummary = {
  customer_id: number;
  name: string;
  environment: FinanceEnvironment;
  balance_cents: number;
  reserved_cents: number;
  available_cents: number;
  debts_cents: number;
  credit_limit_cents: number;
  account_revision: number;
  opening_debts_cents: number;
  legacy_debt_unallocated_cents: number;
  legacy_debt_review_required: boolean;
};
export type FinanceLink = {
  id: string;
  external_customer_id: string;
  customer_id: number;
  environment: FinanceEnvironment;
  status: "PENDING" | "APPROVED" | "REJECTED";
  version: number;
  name: string;
  document: string;
  created_at: string;
  summary?: FinanceSummary;
};
export type FinancePurchase = {
  id: string;
  external_customer_id: string;
  external_order_id: string;
  customer_id: number;
  environment: FinanceEnvironment;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  version: number;
  amount_cents: number;
  reserved_cents: number;
  cash_applied_cents: number;
  consented_projected_balance_cents: number;
  balance_before_cents: number;
  projected_balance_cents: number;
  requires_approval: boolean;
  core_order_id: number | null;
  reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: number | null;
  order_snapshot: {
    items: Array<{ name: string; quantity: number; unit_price_cents: number; product_id?: number }>;
    [key: string]: unknown;
  };
  summary: FinanceSummary;
  customer: { id: number; name: string; cpf: string | null; cnpj: string | null };
  audit: Array<{ id: string; action: string; reason: string | null; user_id: number | null; created_at: string }>;
};
/**
 * Internal server-only: Authorization Bearer CUSTOMER_FINANCE_INTERNAL_TOKEN, >=32 chars.
 * API rejects missing/short token. environment is REQUIRED for every internal request.
 * POST /api/v1/commerce-finance/customers/link:
 * { external_customer_id, document, name, email?, address?:{zip_code,neighborhood,public_place,city,state,address_number,complement?}, environment }
 * Existing CPF/CNPJ never authorizes identity: link returns PENDING without summary.
 * GET /customers/:externalId/link?environment -> FinanceLink (pending accessible, no balance)
 * GET /customers/:externalId/summary?environment -> FinanceSummary (only approved links)
 * GET /customers/:externalId/statement?environment -> Array<{id,customer_id,environment,entry_key,kind,amount_cents,purchase_id,deposit_id,payment_id,description,created_at}>
 * GET /customers/:externalId/deposits?environment -> deposits[]
 * POST /purchases {idempotency_key,external_customer_id,external_order_id,amount_cents,environment,order_snapshot,expected_account_revision,expected_projected_balance_cents}
 * GET /purchases/:id?environment; GET /purchases/by-order/:externalOrderId?environment -> FinancePurchase
 * POST /purchases/:id/renew-consent {version,expected_account_revision,expected_projected_balance_cents,environment}
 * Projected amount on renewal includes own reservation: summary.available_cents + purchase.reserved_cents - purchase.amount_cents.
 * POST /purchases/:id/cancel {version,reason?,environment}
 * POST /purchases/:id/link-order {core_order_id,environment} (idempotent, validates customer/price/items)
 * POST /deposit-claims {idempotency_key,external_customer_id,amount_cents,deposited_at,reference?,environment}
 * POST /deposits {idempotency_key,external_customer_id,amount_cents,environment} -> FinanceDeposit
 * GET /deposits/:id?environment; POST /deposits/:id/sync {environment}
 *
 * Admin JWT /api/v1/customer-finance (requireAdmin):
 * GET /customers?environment; GET /customers/:coreId/summary?environment; GET /customers/:coreId/statement?environment
 * GET /links?status&environment; POST /links/:id/approve|reject {version,reason}
 * GET /approvals?status&environment; GET /approvals/:id
 * POST /approvals/:id/approve {version,account_revision,reason}; reject {version,reason}
 * APPROVAL MUST carry latest detail.summary.account_revision; stale preview ->409 refresh.
 * POST /approvals/:id/link-order {core_order_id}; POST /approvals/:id/register-order {version,products:[{id,quantity,unit_price}]}
 * register-order creates and links atomically/idempotently, preferred over legacy Orders POST + link.
 * GET /deposits?status&environment; POST /deposits/:id/confirm {version,bank_entry_id,reason}
 * POST /deposits/:id/reject {version,reason}; POST /bank-entries/sync {start,end}; GET /bank-entries
 * Bank claim confirmation requires an uncredited authenticated bank CREDIT; receipt alone never credits.
 */
export type FinanceDeposit = {
  id: string;
  customer_id: number;
  external_customer_id: string;
  environment: FinanceEnvironment;
  status: "PENDING" | "OPEN" | "UNKNOWN" | "CREDITED" | "REJECTED";
  kind: "BANK_CLAIM" | "BOLETO";
  version: number;
  amount_cents: number;
  deposited_at: string | null;
  reference: string | null;
  invoice_id: string | null;
  boleto_url: string | null;
  digitable: string | null;
  created_at: string;
};
