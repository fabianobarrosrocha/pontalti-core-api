import prisma, { dbErrorHandle } from "@pontalti/lib/prisma";
import { PaginationResponse } from "@pontalti/types/common.types";
import { SalesForecast, SalesForecastRegister, SalesForecastRequest, UpdatePartialSalesForecast } from "@pontalti/types/sales-forecast.types";

const defaultSelect = {
  id: true,
  status: true,
  reason: true,
  next_estimated_date: true,
  frequency_days: true,
  quantity: true,
  created_at: true,
  created_by: true,
  updated_at: true,
  updated_by: true,
  customer: {
    select: {
      id: true,
      status: true,
      address_id: true,
      credit_limit: true,
      debts: true,
      name: true,
      phone: true,
      cel_number: true,
      email: true,
      store_name: true,
      deliver: true,
      pontalti: true,
      secondary_line: true,
      cpf: true,
      cnpj: true,
      created_at: true,
      updated_at: true,
      address: {
        select: {
          id: true,
          zip_code: true,
          neighborhood: true,
          public_place: true,
          city: true,
          state: true,
          complement: true,
          address_number: true,
        }
      }
    }
  },
  product: {
    select: {
      id: true,
      type: true,
      sku: true,
      status: true,
      inner_color_id: true,
      foam_id: true,
      outer_color_id: true,
      mold_id: true,
      inner_color: true,
      outer_color: true,
      foam: true,
      mold: true,
      created_at: true,
      updated_at: true,
    }
  },
};

const mapToDomain = (row: any): SalesForecast => row as SalesForecast;

const createSalesForecast = async (data: SalesForecastRegister): Promise<SalesForecast> => {
  try {
    // Prisma Decimal handled by client; accept string quantity
    // @ts-ignore
    const { customer_id, product_id, ...rest } = data as any;
    const created = await prisma.salesForecasts.create({
      data: {
        ...rest,
        customer: { connect: { id: customer_id } },
        product: { connect: { id: product_id } },
      },
      select: defaultSelect,
    });
    return mapToDomain(created);
  } catch (e) {
    dbErrorHandle(e);
  }
};

const getSalesForecast = async (id: number): Promise<SalesForecast> => {
  try {
    const found = await prisma.salesForecasts.findUnique({ where: { id }, select: defaultSelect });
    // @ts-ignore
    if (!found) return null;
    return mapToDomain(found);
  } catch (e) {
    dbErrorHandle(e);
  }
};

const getSalesForecasts = async (filters: SalesForecastRequest): Promise<PaginationResponse<SalesForecast>> => {
  try {
    const { page = 1, perPage = 10, ...where } = filters;
    const skip = page !== 1 ? (page - 1) * perPage : undefined;
    // Map nested relations filters if needed
    const result = await prisma.salesForecasts.findMany({
      where: {
        status: where.status,
      },
      select: defaultSelect,
      take: perPage,
      skip,
      orderBy: { id: "desc" },
    });
    const totalRecords = await prisma.salesForecasts.count({
      where: {
        status: where.status,
      },
    });
    return {
      data: result.map(mapToDomain),
      totalRecord: totalRecords,
      page,
      perPage,
      nextPage: result.length === perPage ? `/api/sales-forecasts?page=${page + 1}` : undefined,
    };
  } catch (e) {
    dbErrorHandle(e);
  }
};

const updatePartialSalesForecast = async (id: number, data: UpdatePartialSalesForecast): Promise<SalesForecast> => {
  try {
    // Allow only updatable fields; prevent editing ids
    // @ts-ignore
    const updateData: any = {};
    const editable = [
      "status",
      "reason",
      "next_estimated_date",
      "frequency_days",
      "quantity",
      "updated_by",
    ];
    for (const key of editable) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    const updated = await prisma.salesForecasts.update({ where: { id }, data: updateData, select: defaultSelect });
    return mapToDomain(updated);
  } catch (e) {
    dbErrorHandle(e);
  }
};

const deleteSalesForecast = async (id: number): Promise<SalesForecast> => {
  try {
    const deleted = await prisma.salesForecasts.delete({ where: { id }, select: defaultSelect });
    return mapToDomain(deleted);
  } catch (e) {
    dbErrorHandle(e);
  }
};

export default {
  createSalesForecast,
  getSalesForecast,
  getSalesForecasts,
  updatePartialSalesForecast,
  deleteSalesForecast,
};

// Forecast data helpers
export const getDeliveredCustomerProductHistory = async (
  customerId: number,
  productId: number,
  since: Date
): Promise<Array<{ date: Date; quantity: number }>> => {
  try {
    const rows = await prisma.orderItems.findMany({
      where: {
        product_id: productId,
        order: {
          customer_id: customerId,
          date: { gte: since },
          deliveries: { some: { status: 3 } },
        },
      },
      select: {
        quantity: true,
        order: { select: { date: true } },
      },
      orderBy: { order: { date: "desc" } },
    });
    return rows.map(r => ({ date: r.order.date as Date, quantity: r.quantity as number }));
  } catch (e) {
    dbErrorHandle(e);
  }
};

export const getDeliveredProductHistory = async (
  productId: number,
  since: Date
): Promise<Array<{ date: Date; quantity: number }>> => {
  try {
    const rows = await prisma.orderItems.findMany({
      where: {
        product_id: productId,
        order: {
          date: { gte: since },
          deliveries: { some: { status: 3 } },
        },
      },
      select: {
        quantity: true,
        order: { select: { date: true } },
      },
      orderBy: { order: { date: "desc" } },
    });
    return rows.map(r => ({ date: r.order.date as Date, quantity: r.quantity as number }));
  } catch (e) {
    dbErrorHandle(e);
  }
};


