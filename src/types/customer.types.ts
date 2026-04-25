import { CommonRequest, Status } from "./common.types";
import { Address } from "./address.types";

export type Customer = {
  id: number;
  name: string;
  status: Status;
  phone?: string | null;
  cel_number?: string | null;
  email?: string | null;
  store_name: string;
  deliver: boolean;
  pontalti: boolean;
  secondary_line: boolean;
  credit_limit: number;
  debts: number;
  address: Address;
  cpf?: string | null;
  cnpj?: string | null;
  created_at: Date;
  updated_at: Date;
};

export type CustomerRegister = Omit<Customer, "id" | "created_at" | "updated_at">;

export type CustomerRequest = CommonRequest<Omit<Customer, "credit_limit">>

export type CustomerStatusString = Omit<Customer, "status"> & { status: string };

export type UpdatePartialCustomer = Partial<Customer>;
