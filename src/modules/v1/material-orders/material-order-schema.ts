import * as yup from 'yup';

const createMaterialOrderSchema = yup.object({
  body: yup.object({
    date: yup.date().required(),
    amount: yup.number().integer().required(),
    unit: yup.string().required(),
    storage_location: yup.string().required(),
    received_by: yup.string().required(),
    product_id: yup.number().integer().required(),
    vendor_id: yup.number().integer().required()
  })
})

export {
  createMaterialOrderSchema
}
