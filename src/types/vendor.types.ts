import { Status } from "./common.types";
import { Address } from "./address.types";

export type Vendor = {
  id: number;
  name: string;
  store_name: string;
  cnpj: string;
  status: Status;
  phone?: string | null;
  cel_number?: string | null;
  deliver: boolean;
  volume_purchases: number;
  purchases: number;
  invoicing: number;
  address: Address;
  created_at: Date;
  updated_at: Date;
};

export type VendorRegister = Omit<Vendor, "id" | "created_at" | "updated_at">;
