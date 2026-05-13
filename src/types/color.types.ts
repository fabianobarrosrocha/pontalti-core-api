export type Color = {
  id: number;
  name: string;
  short_code: string;
  hex_code?: string | null;
  status: number;
  created_at: Date;
  updated_at: Date;
};

export type ColorRegister = Omit<Color, "id" | "created_at" | "updated_at">;
