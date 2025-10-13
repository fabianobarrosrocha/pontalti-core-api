export type ExpenseActor = {
  id: number;
  first_name?: string;
  last_name?: string;
  whatsapp_telegram?: string;
  store_name?: string;
  vendor_id?: number | null;
  employee_id?: number | null;
  customer_id?: number | null;
  order_id?: number | null;
  created_at: Date;
  updated_at: Date;
};
