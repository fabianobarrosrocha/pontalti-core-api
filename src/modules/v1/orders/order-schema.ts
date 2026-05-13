import * as yup from 'yup';

const createOrderSchema = yup.object({
  body: yup.object({
    order: yup.object({
      final_price: yup.number().required(),
      discount: yup.number().min(0).optional(),
      date: yup.date().required(),
      customer_id: yup.number().required(),
    }),
    products: yup.array().of(
      yup.object({
        id: yup.number().required(),
        quantity: yup.number().required()
      })
    )
  })
})

export {
  createOrderSchema
}