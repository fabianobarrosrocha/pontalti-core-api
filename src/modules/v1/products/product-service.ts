import productRepository from "@pontalti/repository/product";
import colorRepository from "@pontalti/repository/color";
import foamRepository from "@pontalti/repository/foam";
import moldRepository from "@pontalti/repository/mold";
import { CommonRequest } from "@pontalti/types/common.types";
import { Product, ProductGenerateInput, ProductRegister, ProductType } from "@pontalti/types/product.types";
import { buildSku } from "@pontalti/utils/product-sku";

const ensureCatalogsForVariant = async (
  type: ProductType,
  inner_color_id: number,
  foam_id: number,
  outer_color_id: number,
  mold_id: number | null
) => {
  const [inner, outer, foam, mold] = await Promise.all([
    colorRepository.getColor(inner_color_id),
    colorRepository.getColor(outer_color_id),
    foamRepository.getFoam(foam_id),
    mold_id ? moldRepository.getMold(mold_id) : Promise.resolve(null)
  ]);

  if (!inner) throw new Error(`Cor interna (id=${inner_color_id}) não encontrada.`);
  if (!outer) throw new Error(`Cor externa (id=${outer_color_id}) não encontrada.`);
  if (!foam) throw new Error(`Espuma (id=${foam_id}) não encontrada.`);
  if (type === "bojo" && !mold) {
    throw new Error("Bojo exige um molde válido.");
  }
  if (type === "dublado" && mold_id) {
    throw new Error("Dublado não deve ter molde.");
  }

  return { inner, outer, foam, mold };
};

const createProduct = async (data: ProductRegister): Promise<Product> => {
  const mold_id = data.type === "dublado" ? null : data.mold_id ?? null;

  const { inner, outer, foam, mold } = await ensureCatalogsForVariant(
    data.type,
    data.inner_color_id,
    data.foam_id,
    data.outer_color_id,
    mold_id
  );

  const sku = buildSku({
    type: data.type,
    innerColorCode: inner.short_code,
    foamCode: foam.short_code,
    outerColorCode: outer.short_code,
    moldCode: mold?.short_code ?? null
  });

  return await productRepository.createProduct({ ...data, mold_id, sku });
};

const generateProducts = async (input: ProductGenerateInput) => {
  const moldIds = input.type === "bojo" && input.mold_ids?.length ? input.mold_ids : [null];
  const created: Product[] = [];
  const skipped: Array<{ inner_color_id: number; foam_id: number; outer_color_id: number; mold_id: number | null }> =
    [];

  for (const inner_color_id of input.inner_color_ids) {
    for (const foam_id of input.foam_ids) {
      for (const outer_color_id of input.outer_color_ids) {
        for (const mold_id of moldIds as (number | null)[]) {
          const existing = await productRepository.findExistingVariant(
            input.type,
            inner_color_id,
            foam_id,
            outer_color_id,
            mold_id
          );
          if (existing) {
            skipped.push({ inner_color_id, foam_id, outer_color_id, mold_id });
            continue;
          }
          try {
            const variant = await createProduct({
              type: input.type,
              inner_color_id,
              foam_id,
              outer_color_id,
              mold_id,
              status: input.status
            });
            created.push(variant);
          } catch (e) {
            skipped.push({ inner_color_id, foam_id, outer_color_id, mold_id });
          }
        }
      }
    }
  }

  return { created, skipped, summary: { created: created.length, skipped: skipped.length } };
};

const getAllProducts = async (filters: CommonRequest<Product>) => {
  return await productRepository.getProducts(filters);
};

const getProductById = async (id: number) => {
  return await productRepository.getProduct(id);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updatePartialProduct = async (id: number, data: any) => {
  // Se algum atributo que compõe o SKU mudou, recalcular
  const currentProduct = await productRepository.getProduct(id);
  if (!currentProduct) throw new Error("Produto não encontrado.");

  const next = {
    type: (data.type ?? currentProduct.type) as ProductType,
    inner_color_id: data.inner_color_id ?? currentProduct.inner_color_id,
    foam_id: data.foam_id ?? currentProduct.foam_id,
    outer_color_id: data.outer_color_id ?? currentProduct.outer_color_id,
    mold_id: data.mold_id ?? currentProduct.mold_id ?? null
  };

  const normalizedMoldId = next.type === "dublado" ? null : next.mold_id;

  const { inner, outer, foam, mold } = await ensureCatalogsForVariant(
    next.type,
    next.inner_color_id,
    next.foam_id,
    next.outer_color_id,
    normalizedMoldId
  );

  const sku = buildSku({
    type: next.type,
    innerColorCode: inner.short_code,
    foamCode: foam.short_code,
    outerColorCode: outer.short_code,
    moldCode: mold?.short_code ?? null
  });

  return await productRepository.updatePartialProduct(id, { ...data, mold_id: normalizedMoldId, sku });
};

const deleteProduct = async (id: number) => {
  return await productRepository.deleteProduct(id);
};

export default {
  createProduct,
  generateProducts,
  getProductById,
  getAllProducts,
  updatePartialProduct,
  deleteProduct
};
