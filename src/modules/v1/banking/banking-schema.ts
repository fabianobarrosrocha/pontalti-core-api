import * as yup from "yup";
import { MAX_AMOUNT_CENTS, PAYROLL_KINDS, validDate } from "./banking-domain";

const positiveId = () => yup.number().integer().positive().required();
const digits = (min: number, max: number) => yup.string().required().matches(new RegExp(`^\\d{${min},${max}}$`));
const date = () => yup.string().required().test("date", "Data inválida.", (value) => validDate(value ?? ""));

export const accountSchema = yup.object({
  bank_code: digits(3, 3),
  branch_number: digits(1, 4),
  account_number: digits(1, 13),
  account_type: yup.string().oneOf(["CHECKING", "SAVINGS", "PAYMENT"]).required(),
  version: yup.number().integer().min(0).required()
}).noUnknown();

export const payrollSchema = yup.object({
  id: yup.string().uuid().required(),
  version: positiveId().optional(),
  competence: yup.string().matches(/^20\d{2}-(0[1-9]|1[0-2])$/).required(),
  kind: yup.string().oneOf([...PAYROLL_KINDS]).required(),
  payment_date: date(),
  submit_at_local: yup.string().required(),
  auto_submit_to_cora: yup.boolean().required(),
  items: yup.array().of(yup.object({
    employee_id: positiveId(),
    amount_cents: yup.number().integer().min(1).max(MAX_AMOUNT_CENTS).required()
  }).noUnknown()).min(1).max(500).required()
}).noUnknown();

export const versionSchema = yup.object({ version: positiveId() }).noUnknown();

export const settingsSchema = yup.object({
  version: positiveId(),
  auto_submit_to_cora: yup.boolean().required(),
  paused: yup.boolean().required()
}).noUnknown();

export async function validateBody<T extends yup.AnyObjectSchema>(schema: T, body: unknown): Promise<yup.InferType<T>> {
  return schema.validate(body, { strict: true, abortEarly: false });
}

export function validateUuid(value: string) {
  return yup.string().uuid().required().validateSync(value, { strict: true });
}
