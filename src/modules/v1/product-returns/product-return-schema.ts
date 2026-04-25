import * as yup from "yup";
import { sanitizeBoolean } from "@pontalti/utils/sanitizer";

const createProductReturnSchema = yup.object({
  body: yup.object({
    product_return: yup
      .object({
        date: yup.date().required(),
        replacement_necessary: yup.boolean().required().transform(sanitizeBoolean),
        resold: yup.boolean().required().transform(sanitizeBoolean),
        return_reason: yup.string().required(),
        storage_location: yup.string().required(),
        order_id: yup.number().required().positive().integer()
      })
      .required(),
    returned_labels: yup
      .array()
      .of(
        yup.object({
          ticket_code: yup.string().required(),
          opened: yup.boolean().required().transform(sanitizeBoolean),
          quantity: yup.number().required().positive().integer()
        })
      )
      .required()
      .min(1)
  })
});

export { createProductReturnSchema };
