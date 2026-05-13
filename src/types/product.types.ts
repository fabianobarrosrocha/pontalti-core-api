import { Color } from "./color.types";
import { Foam } from "./foam.types";
import { Mold } from "./mold.types";

export type ProductType = "bojo" | "dublado";

export type Product = {
  id: number;
  type: ProductType;
  inner_color_id: number;
  foam_id: number;
  outer_color_id: number;
  mold_id?: number | null;
  sku: string;
  status: number;
  created_at: Date;
  updated_at: Date;
  inner_color?: Color;
  outer_color?: Color;
  foam?: Foam;
  mold?: Mold | null;
};

export type ProductRegister = {
  type: ProductType;
  inner_color_id: number;
  foam_id: number;
  outer_color_id: number;
  mold_id?: number | null;
  status: number;
};

export type ProductGenerateInput = {
  type: ProductType;
  inner_color_ids: number[];
  foam_ids: number[];
  outer_color_ids: number[];
  mold_ids?: number[];
  status: number;
};
