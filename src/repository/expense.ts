import prisma, { dbErrorHandle } from "@pontalti/lib/prisma";
import { PaginationResponse } from "@pontalti/types/common.types";
import { Expense, ExpenseRegister, ExpenseRequest } from "@pontalti/types/expense.types";

const defaultSelect = {
  id: true,
  amount: true,
  classification: true,
  description: true,
  justification: true,
  requires_reimbursement: true,
  applies_all_products: true,
  applies_all_machines: true,
  expense_date: true,
  expense_actor_id: true,
  created_at: true,
  created_by: true,
  updated_at: true,
  updated_by: true,
  actor: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      whatsapp_telegram: true,
      store_name: true,
      vendor_id: true,
      employee_id: true,
      customer_id: true,
      order_id: true,
      created_at: true,
      updated_at: true,
    }
  }
};

const mapDecimal = (row: any): Expense => ({ ...row, amount: row?.amount?.toString?.() ?? String(row.amount) });

const createExpense = async (data: ExpenseRegister): Promise<Expense> => {
  try {
    const created = await (prisma as any).expenses.create({ data, select: defaultSelect });
    return mapDecimal(created);
  } catch (e) { dbErrorHandle(e); }
};

const getExpense = async (id: number): Promise<Expense> => {
  try {
    const found = await (prisma as any).expenses.findUnique({ where: { id }, select: defaultSelect });
    return found ? mapDecimal(found) : null;
  } catch (e) { dbErrorHandle(e); }
};

const getExpenses = async (filters: ExpenseRequest): Promise<PaginationResponse<Expense>> => {
  try {
    const { page = 1, perPage = 10, ...where } = filters;
    const skip = page !== 1 ? (page - 1) * perPage : undefined;
    const result = await (prisma as any).expenses.findMany({ where, select: defaultSelect, take: perPage, skip, orderBy: { id: "desc" } });
    const totalRecords = await (prisma as any).expenses.count({ where });
    return { data: result.map(mapDecimal), totalRecord: totalRecords, page, perPage, nextPage: result.length === perPage ? `/api/expenses?page=${page + 1}` : undefined };
  } catch (e) { dbErrorHandle(e); }
};

const updatePartialExpense = async (id: number, data: Partial<ExpenseRegister>): Promise<Expense> => {
  try {
    const editable = [
      "amount", "classification", "description", "justification", "requires_reimbursement",
      "applies_all_products", "applies_all_machines", "expense_date", "expense_actor_id", "updated_by"
    ];
    const updateData: any = {};
    for (const key of editable) if ((data as any)[key] !== undefined) updateData[key] = (data as any)[key];
    const updated = await (prisma as any).expenses.update({ where: { id }, data: updateData, select: defaultSelect });
    return mapDecimal(updated);
  } catch (e) { dbErrorHandle(e); }
};

const deleteExpense = async (id: number): Promise<Expense> => {
  try { const deleted = await (prisma as any).expenses.delete({ where: { id }, select: defaultSelect }); return mapDecimal(deleted); } catch (e) { dbErrorHandle(e); }
};

export default {
  createExpense,
  getExpense,
  getExpenses,
  updatePartialExpense,
  deleteExpense,
};


