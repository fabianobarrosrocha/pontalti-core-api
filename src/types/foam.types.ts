export type Foam = {
  id: number;
  name: string;
  short_code: string;
  size: string;
  description?: string | null;
  status: number;
  created_at: Date;
  updated_at: Date;
};

export type FoamRegister = Omit<Foam, "id" | "created_at" | "updated_at">;
