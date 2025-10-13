import { MaterialConsumption, MaterialConsumptionRegister, MaterialConsumptionRequest, UpdatePartialMaterialConsumption } from "@pontalti/types/material-consumption.types";
import prisma, { dbErrorHandle } from "@pontalti/lib/prisma";
import { PaginationResponse } from "@pontalti/types/common.types";

const defaultInclude = {
  production_control: {
    include: {
      order: {
        include: {
          customer: true
        }
      }
    }
  },
  material_order: {
    include: {
      product: true,
      vendor: true
    }
  }
};

const createMaterialConsumption = async (data: MaterialConsumptionRegister): Promise<any> => {
  try {
    return await prisma.materialConsumption.create({
      data,
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getMaterialConsumption = async (id: number): Promise<any> => {
  try {
    return await prisma.materialConsumption.findUnique({ 
      where: { id }, 
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getMaterialConsumptions = async (filters: MaterialConsumptionRequest): Promise<PaginationResponse<any>> => {
  try {
    const { page = 1, perPage = 10, ...where } = filters;
    const skip = page !== 1 ? (page - 1) * perPage : undefined;
    
    // Filtrar apenas campos válidos para o where
    const validWhereFields: any = {};
    if (where.id !== undefined) validWhereFields.id = where.id;
    if (where.production_control_id !== undefined) validWhereFields.production_control_id = where.production_control_id;
    if (where.material_order_id !== undefined) validWhereFields.material_order_id = where.material_order_id;
    if (where.planned_consumption !== undefined) validWhereFields.planned_consumption = where.planned_consumption;
    if (where.actual_consumption !== undefined) validWhereFields.actual_consumption = where.actual_consumption;
    if (where.variance !== undefined) validWhereFields.variance = where.variance;
    if (where.consumption_date !== undefined) validWhereFields.consumption_date = where.consumption_date;
    
    const result = await prisma.materialConsumption.findMany({
      where: validWhereFields,
      include: defaultInclude,
      take: perPage,
      skip
    });
    const totalRecords = await prisma.materialConsumption.count({ where: validWhereFields });
    return {
      data: result,
      totalRecord: totalRecords,
      page,
      perPage,
      nextPage: result.length === perPage ? `/api/material-consumptions?page=${page + 1}` : undefined
    };
  } catch(e) {
    dbErrorHandle(e);
  }
};

const updatePartialMaterialConsumption = async (id: number, data: UpdatePartialMaterialConsumption): Promise<any> => {
  try {
    const {
      production_control_id,
      material_order_id,
      planned_consumption,
      actual_consumption,
      variance,
      consumption_date
    } = data;
    
    const updateData: any = {};
    if (production_control_id !== undefined) updateData.production_control_id = production_control_id;
    if (material_order_id !== undefined) updateData.material_order_id = material_order_id;
    if (planned_consumption !== undefined) updateData.planned_consumption = planned_consumption;
    if (actual_consumption !== undefined) updateData.actual_consumption = actual_consumption;
    if (variance !== undefined) updateData.variance = variance;
    if (consumption_date !== undefined) updateData.consumption_date = consumption_date;
    
    return await prisma.materialConsumption.update({
      where: { id },
      data: updateData,
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const deleteMaterialConsumption = async (id: number): Promise<any> => {
  try {
    return await prisma.materialConsumption.delete({ 
      where: { id }, 
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getConsumptionsByProductionControl = async (productionControlId: number): Promise<any[]> => {
  try {
    return await prisma.materialConsumption.findMany({
      where: { production_control_id: productionControlId },
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

export default {
  createMaterialConsumption,
  getMaterialConsumption,
  getMaterialConsumptions,
  updatePartialMaterialConsumption,
  deleteMaterialConsumption,
  getConsumptionsByProductionControl
};
