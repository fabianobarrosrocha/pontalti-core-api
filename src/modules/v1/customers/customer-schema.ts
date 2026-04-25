import * as yup from 'yup';
// import { validateCpf } from "@pontalti/modules/v1/customers/customer-validator";
// import { custom } from '@pontalti/utils/validator';
import { sanitizeSpecialCharacters, sanitizeBoolean } from "@pontalti/utils/sanitizer";
import { cpf, cnpj } from 'cpf-cnpj-validator';

// custom('validateCpf', validateCpf, 'CPF must be valid');

const sanitizeOptionalDigits = (currentValue) => {
  const sanitized = sanitizeSpecialCharacters(currentValue);
  return sanitized === '' ? undefined : sanitized;
};

const emptyStringToUndefined = (currentValue) => currentValue === '' ? undefined : currentValue;

const createCustomerSchema = yup.object({
  body: yup.object({
    name: yup.string().required(),
    status: yup.number().required(),
    phone: yup.string().optional().transform(sanitizeOptionalDigits).length(10),
    cel_number: yup.string().optional().transform(sanitizeOptionalDigits).length(11),
    email: yup.string().optional().transform(emptyStringToUndefined).email(),
    store_name: yup.string().required(),
    deliver: yup.boolean().required().transform(sanitizeBoolean),
    pontalti: yup.boolean().required().transform(sanitizeBoolean),
    secondary_line: yup.boolean().required().transform(sanitizeBoolean),
    credit_limit: yup.number().required(),
    cnpj: yup.string().optional().transform(sanitizeOptionalDigits),
    cpf: yup.string().optional().transform(sanitizeOptionalDigits),
    address: yup.object({
      zip_code: yup.string().required().transform(sanitizeSpecialCharacters),
      neighborhood: yup.string().required(),
      public_place: yup.string().required(),
      city: yup.string().required(),
      state: yup.string().required().length(2),
      complement: yup.string().optional(),
      address_number: yup.number().required()
    })
  })
}).test('DocumentValidator', 'A valid CPF or CNPJ is required', function(value) {
  const b = value.body;
  if (!b.phone && !b.cel_number && !b.email) {
    throw this.createError({ message: 'Phone, cell phone or email is required', path: 'body' });
  }

  if (!b.cpf && !b.cnpj) throw this.createError({ message: 'CPF or CNPJ is required', path: 'body' });
  else if(b.cpf && !cpf.isValid(b.cpf)) throw this.createError({ message: 'CPF is not valid'});
  else if (b.cnpj && !cnpj.isValid(b.cnpj)) throw this.createError({ message: 'CNPJ is not valid'});

  return true;
})

export {
  createCustomerSchema
}
