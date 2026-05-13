export enum Classification {
  funcionario,
  em_teste,
  externo,
  gerente
}

export type Employee = {
  id: number;
  email: string;
  name: string;
  phone: string;
  cel_number: string;
  cpf: string;
  classification: Classification;
  admission: Date;
  salary?: number;
  dismissal_date?: Date;
  created_at: Date;
  updated_at: Date;
};

export type EmployeeRegister = Omit<Employee, "id" | "created_at" | "updated_at">

export type EmployeeClassificationString =  Omit<Employee, "classification"> & { classification: string };
