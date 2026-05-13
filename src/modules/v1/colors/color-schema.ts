import { Status } from "@pontalti/types/common.types";
import * as yup from "yup";

const shortCodePattern = /^[A-Z0-9]{2,5}$/;

const createColorSchema = yup.object({
  body: yup.object({
    name: yup.string().required().trim().min(2),
    short_code: yup
      .string()
      .required()
      .uppercase()
      .matches(shortCodePattern, "short_code deve ter 2-5 letras/dígitos maiúsculos"),
    hex_code: yup.string().optional().matches(/^#?[0-9A-Fa-f]{6}$/, "hex_code inválido").nullable(),
    status: yup.mixed<Status>().oneOf([Status.Suspenso, Status.Operacional]).required()
  })
});

const updateColorSchema = yup.object({
  body: yup.object({
    name: yup.string().optional().trim().min(2),
    short_code: yup
      .string()
      .optional()
      .uppercase()
      .matches(shortCodePattern, "short_code deve ter 2-5 letras/dígitos maiúsculos"),
    hex_code: yup.string().optional().matches(/^#?[0-9A-Fa-f]{6}$/, "hex_code inválido").nullable(),
    status: yup.mixed<Status>().oneOf([Status.Suspenso, Status.Operacional]).optional()
  })
});

export { createColorSchema, updateColorSchema };
