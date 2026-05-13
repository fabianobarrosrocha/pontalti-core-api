import * as yup from 'yup';

const createMaterialOrderSchema = yup.object({
  body: yup.object({
    date: yup
      .date()
      .test('not-future', 'A data do recebimento não pode ser futura.', (value) => {
        return !value || value.getTime() <= Date.now();
      })
      .required(),
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
