import { Classification } from '@pontalti/types/employee.types';
import { sanitizeBoolean, sanitizeSpecialCharacters } from "@pontalti/utils/sanitizer";
import * as yup from 'yup';

const createEmployeeSchema = yup.object({
  body: yup.object({
    email: yup.string().email().required(),
    name: yup.string().required(),
    phone: yup.string().required().transform(sanitizeSpecialCharacters).length(10),
    cel_number: yup.string().required().transform(sanitizeSpecialCharacters).length(11),
    cpf: yup.string().required().transform(sanitizeSpecialCharacters),
    classification: yup.mixed<Classification>().oneOf([Classification.funcionario, Classification.em_teste, Classification.externo, Classification.gerente]).required(),
    admission: yup.date().required(),
    salary: yup.number().optional(),
    dismissal_date: yup.date().optional(),
  })
})

export {
  createEmployeeSchema
}
