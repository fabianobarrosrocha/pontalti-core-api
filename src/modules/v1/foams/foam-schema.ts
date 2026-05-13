import { Status } from "@pontalti/types/common.types";
import * as yup from "yup";

const shortCodePattern = /^[A-Z0-9]{2,5}$/;

const createFoamSchema = yup.object({
  body: yup.object({
    name: yup.string().required().trim().min(2),
    short_code: yup
      .string()
      .required()
      .uppercase()
      .matches(shortCodePattern, "short_code deve ter 2-5 letras/dígitos maiúsculos"),
    density: yup.string().optional().nullable(),
    status: yup.mixed<Status>().oneOf([Status.Suspenso, Status.Operacional]).required()
  })
});

const updateFoamSchema = yup.object({
  body: yup.object({
    name: yup.string().optional().trim().min(2),
    short_code: yup
      .string()
      .optional()
      .uppercase()
      .matches(shortCodePattern, "short_code deve ter 2-5 letras/dígitos maiúsculos"),
    density: yup.string().optional().nullable(),
    status: yup.mixed<Status>().oneOf([Status.Suspenso, Status.Operacional]).optional()
  })
});

export { createFoamSchema, updateFoamSchema };
