import * as yup from "yup";

const createOrderSchema = yup.object({
  body: yup.object({
    order: yup.object({
      final_price: yup.number().required(),
      discount: yup.number().optional(),
      date: yup.date().required(),
      // 1: Registrado na fábrica (confirmed), 2: Em produção, 3: Enviado, 4: Entregue, 5: Cancelado — espelha os status da loja online
      status: yup.number().integer().min(1).max(5).optional(),
      customer_id: yup.number().required()
    }),
    products: yup
      .array()
      .of(
        yup.object({
          id: yup.number().required(),
          quantity: yup.number().required(),
          unit_price: yup.number().min(0).required(),
          registered_price: yup.number().min(0).nullable().optional()
        })
      )
      .min(1, "Inclua ao menos um produto.")
      .required()
  })
});

export { createOrderSchema };
