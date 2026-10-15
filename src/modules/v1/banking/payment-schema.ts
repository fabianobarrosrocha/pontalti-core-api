import * as yup from "yup";
import { cpf, cnpj } from "cpf-cnpj-validator";
import { accountSchema } from "./banking-schema";
import { MAX_AMOUNT_CENTS, validDate } from "./banking-domain";

const uuid = () => yup.string().uuid().required();
const cents = () => yup.number().integer().min(1).max(MAX_AMOUNT_CENTS).required();
const date = () =>
  yup
    .string()
    .required()
    .test("date", "Data inválida.", (value) => validDate(value ?? ""));
export const beneficiarySchema = accountSchema
  .shape({
    name: yup.string().trim().min(2).max(150).required(),
    document: yup
      .string()
      .matches(/^\d{11}$|^\d{14}$/)
      .required(),
    document_type: yup.string().oneOf(["CPF", "CNPJ"]).required(),
    employee_id: yup.number().integer().positive().nullable().defined(),
    vendor_id: yup.number().integer().positive().nullable().defined(),
    active: yup.boolean().required()
  })
  .test("document", "Confira o CPF/CNPJ do favorecido.", (value) =>
    value.document_type === "CPF" ? cpf.isValid(value.document) : cnpj.isValid(value.document)
  )
  .test("link", "Vincule apenas um funcionário ou fornecedor.", (value) => !(value.employee_id && value.vendor_id));

export const payableSchema = yup
  .object({
    id: uuid(),
    purpose: yup.string().oneOf(["SUPPLIER", "REIMBURSEMENT"]).required(),
    beneficiary_id: uuid(),
    expense_id: yup.number().integer().positive().optional(),
    expense: yup
      .object({
        amount_cents: cents(),
        description: yup.string().trim().min(2).max(150).required(),
        classification: yup.string().trim().max(50).required(),
        expense_date: date()
      })
      .noUnknown()
      .default(undefined)
      .optional(),
    due_date: date(),
    justification: yup.string().trim().min(3).max(1000).required()
  })
  .noUnknown()
  .test(
    "origin",
    "Selecione uma despesa existente ou registre uma nova.",
    (value) => Boolean(value.expense_id) !== Boolean(value.expense)
  );

export const paymentSchema = yup
  .object({
    id: uuid(),
    payment_date: date(),
    items: yup
      .array()
      .of(yup.object({ payable_id: uuid(), amount_cents: cents() }).noUnknown())
      .min(1)
      .max(100)
      .required()
  })
  .noUnknown();

export const receiptSchema = yup
  .object({
    name: yup.string().trim().min(1).max(150).required(),
    mime: yup.string().oneOf(["application/pdf", "image/jpeg", "image/png"]).required(),
    content_base64: yup
      .string()
      .max(2666668)
      .matches(/^[A-Za-z0-9+/]*={0,2}$/)
      .required()
  })
  .noUnknown();

export const payableRevisionSchema = yup
  .object({
    version: yup.number().integer().positive().required(),
    beneficiary_id: uuid(),
    due_date: date(),
    justification: yup.string().trim().min(3).max(1000).required(),
    expense: yup
      .object({
        amount_cents: cents(),
        description: yup.string().trim().min(2).max(150).required(),
        classification: yup.string().trim().max(50).required(),
        expense_date: date()
      })
      .noUnknown()
      .required()
  })
  .noUnknown();

export function decodeReceipt(data: yup.InferType<typeof receiptSchema>) {
  const content = Buffer.from(data.content_base64, "base64");
  const valid =
    data.mime === "application/pdf"
      ? content.subarray(0, 5).toString() === "%PDF-"
      : data.mime === "image/png"
        ? content.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
        : content.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
  if (!valid || content.length < 8 || content.length > 2000000 || content.toString("base64") !== data.content_base64) {
    throw Object.assign(new Error("Envie PDF, JPG ou PNG válido de até 2 MB."), { status: 400 });
  }
  return content;
}
