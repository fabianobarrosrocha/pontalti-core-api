export type Mold = {
  id: number;
  name: string;
  short_code: string;
  size: string;
  description?: string | null;
  status: number;
  created_at: Date;
  updated_at: Date;
};

export type MoldRegister = Omit<Mold, "id" | "created_at" | "updated_at">;
