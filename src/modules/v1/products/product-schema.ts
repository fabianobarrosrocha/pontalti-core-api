import { Status } from "@pontalti/types/common.types";
import * as yup from "yup";

const PRODUCT_TYPES = ["bojo", "dublado"] as const;

const createProductSchema = yup.object({
  body: yup.object({
    type: yup.string().oneOf([...PRODUCT_TYPES]).required("Informe o tipo (bojo ou dublado)."),
    inner_color_id: yup.number().integer().required("Informe a cor interna."),
    foam_id: yup.number().integer().required("Informe a espuma."),
    outer_color_id: yup.number().integer().required("Informe a cor externa."),
    mold_id: yup
      .number()
      .integer()
      .nullable()
      .when("type", {
        is: "bojo",
        then: (schema) => schema.required("Bojo exige um molde."),
        otherwise: (schema) => schema.optional().transform((v) => (v === undefined ? null : v))
      }),
    status: yup.mixed<Status>().oneOf([Status.Suspenso, Status.Operacional]).required()
  })
});

const updateProductSchema = yup.object({
  body: yup.object({
    type: yup.string().oneOf([...PRODUCT_TYPES]).optional(),
    inner_color_id: yup.number().integer().optional(),
    foam_id: yup.number().integer().optional(),
    outer_color_id: yup.number().integer().optional(),
    mold_id: yup.number().integer().nullable().optional(),
    status: yup.mixed<Status>().oneOf([Status.Suspenso, Status.Operacional]).optional()
  })
});

const generateProductsSchema = yup.object({
  body: yup.object({
    type: yup.string().oneOf([...PRODUCT_TYPES]).required(),
    inner_color_ids: yup.array().of(yup.number().integer().required()).min(1).required(),
    foam_ids: yup.array().of(yup.number().integer().required()).min(1).required(),
    outer_color_ids: yup.array().of(yup.number().integer().required()).min(1).required(),
    mold_ids: yup
      .array()
      .of(yup.number().integer().required())
      .when("type", {
        is: "bojo",
        then: (schema) => schema.min(1, "Bojo exige ao menos um molde.").required(),
        otherwise: (schema) => schema.optional()
      }),
    status: yup.mixed<Status>().oneOf([Status.Suspenso, Status.Operacional]).required()
  })
});

export { createProductSchema, updateProductSchema, generateProductsSchema };
