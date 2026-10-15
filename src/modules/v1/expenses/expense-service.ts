import repository from "@pontalti/repository/expense";
import prisma from "@pontalti/lib/prisma";
import createError from "http-errors";
import { Prisma } from "@prisma/client";
import { CustomRequest } from "@pontalti/types/common.types";
import { ExpenseRegister, ExpenseRequest, UpdatePartialExpense } from "@pontalti/types/expense.types";

const createExpense = async (data: ExpenseRegister, req?: CustomRequest) => {
  const createdBy = req?.user?.name || "system";
  return repository.createExpense({ ...data, created_by: createdBy });
};

const getExpense = async (id: number) => {
  const exp = await repository.getExpense(id);
  return exp;
};

const getExpenses = async (filters: ExpenseRequest) => {
  const page = await repository.getExpenses(filters);
  return page;
};

const updatePartialExpense = async (id: number, data: UpdatePartialExpense, req?: CustomRequest) => {
  const updatedBy = req?.user?.name || "system";
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('pontalti-bank-payments'))`;
    await assertEditable(id, tx);
    return repository.updatePartialExpense(id, { ...data, updated_by: updatedBy }, tx);
  });
};

const deleteExpense = async (id: number) => {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('pontalti-bank-payments'))`;
    await assertEditable(id, tx);
    return repository.deleteExpense(id, tx);
  });
};

const assertEditable = async (id: number, tx: Prisma.TransactionClient) => {
  const payable = await tx.bankPayable.findUnique({ where: { expense_id: id }, select: { id: true } });
  if (payable) throw createError(409, "Esta despesa está vinculada a pagamentos ou reembolsos e não pode ser alterada ou excluída manualmente.");
  const linked = await tx.bankTransfer.findFirst({ where: { OR: [{ expense_id: id }, { reversal_expense_id: id }] }, select: { id: true } });
  if (linked) throw createError(409, "Este gasto é uma confirmação bancária da folha e não pode ser alterado ou excluído manualmente.");
};

export default {
  createExpense,
  getExpense,
  getExpenses,
  updatePartialExpense,
  deleteExpense,
};
