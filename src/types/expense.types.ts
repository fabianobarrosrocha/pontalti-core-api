import { ExpenseActor } from "./expense-actor.types";

export enum ExpenseResponsibleType {
  EMPLOYEE = 1,
  ORDER = 2,
  CUSTOMER = 3,
  VENDOR = 4,
}

export type Expense = {
  id: number;
  amount: string; // decimal as string
  classification?: string;
  description?: string;
  justification: string;
  requires_reimbursement: boolean;
  applies_all_products: boolean;
  applies_all_machines: boolean;
  expense_date: Date;
  expense_actor_id: number;
  created_at: Date;
  created_by?: string;
  updated_at: Date;
  updated_by?: string;
  actor?: ExpenseActor;
};

export type ExpenseRegister = Omit<Expense, "id" | "created_at" | "updated_at" | "actor">;

export type ExpenseResponse = Expense;

export type ExpenseRequest = Partial<Expense> & { page?: number; perPage?: number };

export type UpdatePartialExpense = Partial<ExpenseRegister>;


