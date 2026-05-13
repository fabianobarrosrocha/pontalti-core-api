import { ProductType } from "@pontalti/types/product.types";

const TYPE_PREFIX: Record<ProductType, string> = {
  bojo: "BJ",
  dublado: "DB"
};

type SkuParts = {
  type: ProductType;
  innerColorCode: string;
  foamCode: string;
  outerColorCode: string;
  moldCode?: string | null;
};

export const buildSku = ({ type, innerColorCode, foamCode, outerColorCode, moldCode }: SkuParts): string => {
  const prefix = TYPE_PREFIX[type];
  const parts = [prefix, innerColorCode, foamCode, outerColorCode];
  if (type === "bojo" && moldCode) parts.push(moldCode);
  return parts.join("-");
};
