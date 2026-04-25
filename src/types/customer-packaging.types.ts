export interface CustomerPackaging {
  id: number;
  customer_id: number;
  packaging_id: number;
  pontalti_brand: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerPackagingWithRelations extends CustomerPackaging {
  customer: {
    id: number;
    name: string;
    email?: string | null;
    store_name: string;
    status: number;
    credit_limit: number;
    debts: number;
  };
  packaging: {
    id: number;
    name: string;
    quantity: number;
    storage_location: string;
  };
}

export interface CreateCustomerPackagingDTO {
  customer_id: number;
  packaging_id: number;
  pontalti_brand: boolean;
}

export interface UpdateCustomerPackagingDTO {
  pontalti_brand?: boolean;
} 
