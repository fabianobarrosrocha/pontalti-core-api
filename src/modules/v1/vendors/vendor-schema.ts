import { Status } from '@pontalti/types/common.types';
import * as yup from 'yup';
import { sanitizeSpecialCharacters, sanitizeBoolean } from "@pontalti/utils/sanitizer";
import { cpf, cnpj } from 'cpf-cnpj-validator';

const sanitizeOptionalDigits = (currentValue) => {
  const sanitized = sanitizeSpecialCharacters(currentValue);
  return sanitized === '' ? undefined : sanitized;
};

const createVendorSchema = yup.object({
  body: yup.object({
    name: yup.string().required(),
    store_name: yup.string().required(),
    cnpj: yup.string().required().transform(sanitizeSpecialCharacters),
    status: yup.mixed<Status>().oneOf([Status.Suspenso, Status.Operacional]).required(),
    phone: yup.string().optional().transform(sanitizeOptionalDigits).length(10),
    cel_number: yup.string().optional().transform(sanitizeOptionalDigits).length(11),
    deliver: yup.boolean().required().transform(sanitizeBoolean),
    volume_purchases: yup.number().required().positive(),
    purchases: yup.number().required().positive(),
    invoicing: yup.number().required().positive(),
    address: yup.object({
      zip_code: yup.string().required().transform(sanitizeSpecialCharacters),
      neighborhood: yup.string().required(),
      public_place: yup.string().required(),
      city: yup.string().required(),
      state: yup.string().required().length(2),
      complement: yup.string().required(),
      address_number: yup.number().required()
    })
  })
}).test('DocumentValidator', 'A valid CNPJ is required', function(value) {
  const b = value.body;
  if (!b.phone && !b.cel_number) {
    throw this.createError({ message: 'Phone or cell phone is required', path: 'body' });
  }

  if (!b.cnpj) throw this.createError({ message: 'CNPJ is required', path: 'body' });
  else if (b.cnpj && !cnpj.isValid(b.cnpj)) throw this.createError({ message: 'CNPJ is not valid'});

  return true;
})


export {
  createVendorSchema
}
