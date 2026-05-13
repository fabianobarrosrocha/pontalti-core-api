import * as yup from 'yup';

const createPaymentSchema = yup.object({
  body: yup.object({
    amount_paid: yup.number().required(),
    date: yup.date().required(),
    payment_method: yup.string().required(),
    order_id: yup.number().integer().required()
  })
})

export {
  createPaymentSchema
}
