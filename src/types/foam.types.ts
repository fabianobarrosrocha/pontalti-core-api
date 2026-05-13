export type Foam = {
  id: number;
  name: string;
  short_code: string;
  density?: string | null;
  status: number;
  created_at: Date;
  updated_at: Date;
};

export type FoamRegister = Omit<Foam, "id" | "created_at" | "updated_at">;
