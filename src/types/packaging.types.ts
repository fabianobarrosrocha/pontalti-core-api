export interface Packaging {
  id: number;
  name: string;
  quantity: number;
  storage_location: string;
  created_at: Date;
  updated_at: Date;
}

export interface PackagingWithRelations extends Packaging {
  customers: {
    id: number;
    customer_id: number;
    packaging_id: number;
    pontalti_brand: boolean;
    created_at: Date;
    updated_at: Date;
    customer: {
      id: number;
      name: string;
      email?: string | null;
      store_name: string;
    }
  }[];
}

export interface CreatePackagingDTO {
  name: string;
  quantity: number;
  storage_location: string;
}

export interface UpdatePackagingDTO {
  name?: string;
  quantity?: number;
  storage_location?: string;
} 
