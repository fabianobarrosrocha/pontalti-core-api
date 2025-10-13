import repository from "@pontalti/repository/expense";
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
  return repository.updatePartialExpense(id, { ...data, updated_by: updatedBy });
};

const deleteExpense = async (id: number) => {
  return repository.deleteExpense(id);
};

export default {
  createExpense,
  getExpense,
  getExpenses,
  updatePartialExpense,
  deleteExpense,
};


