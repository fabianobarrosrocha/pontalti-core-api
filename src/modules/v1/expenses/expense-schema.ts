import * as yup from "yup";

export const expenseCreateSchema = yup.object({
  body: yup.object({
    amount: yup.string().required(),
    classification: yup.string().max(50).optional(),
    description: yup.string().max(150).optional(),
    justification: yup.string().required(),
    requires_reimbursement: yup.boolean().required(),
    applies_all_products: yup.boolean().required(),
    applies_all_machines: yup.boolean().required(),
    expense_date: yup.date().required(),
    responsible_id: yup.number().required(),
    responsible_type: yup.number().oneOf([1, 2, 3, 4]).required(),
  })
});

export const expenseUpdateSchema = yup.object({
  body: yup.object({
    amount: yup.string().optional(),
    classification: yup.string().max(50).optional(),
    description: yup.string().max(150).optional(),
    justification: yup.string().optional(),
    requires_reimbursement: yup.boolean().optional(),
    applies_all_products: yup.boolean().optional(),
    applies_all_machines: yup.boolean().optional(),
    expense_date: yup.date().optional(),
    responsible_id: yup.number().optional(),
    responsible_type: yup.number().oneOf([1, 2, 3, 4]).optional(),
  })
});

export const expenseQuerySchema = yup.object({
  query: yup.object({
    page: yup.number().optional(),
    perPage: yup.number().optional(),
    responsible_type: yup.number().oneOf([1, 2, 3, 4]).optional(),
  })
});


