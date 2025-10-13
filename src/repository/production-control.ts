import { ProductionControl, ProductionControlRegister, ProductionControlRequest, UpdatePartialProductionControl } from "@pontalti/types/production-control.types";
import prisma, { dbErrorHandle } from "@pontalti/lib/prisma";
import { PaginationResponse } from "@pontalti/types/common.types";

const defaultInclude = {
  order: {
    include: {
      customer: {
        include: {
          address: true
        }
      },
      products: {
        include: {
          product: true
        }
      }
    }
  },
  material_consumption: {
    include: {
      material_order: {
        include: {
          product: true,
          vendor: {
            include: {
              address: true
            }
          }
        }
      }
    }
  }
};

const createProductionControl = async (data: ProductionControlRegister): Promise<any> => {
  try {
    return await prisma.productionControl.create({
      data,
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getProductionControl = async (id: number): Promise<any> => {
  try {
    return await prisma.productionControl.findUnique({ 
      where: { id }, 
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getProductionControls = async (filters: ProductionControlRequest): Promise<PaginationResponse<any>> => {
  try {
    const { page = 1, perPage = 10, ...where } = filters;
    const skip = page !== 1 ? (page - 1) * perPage : undefined;
    
    // Filtrar apenas campos válidos para o where
    const validWhereFields: any = {};
    if (where.id !== undefined) validWhereFields.id = where.id;
    if (where.status !== undefined) validWhereFields.status = where.status;
    if (where.material_disponibility !== undefined) validWhereFields.material_disponibility = where.material_disponibility;
    if (where.estimated_start_date !== undefined) validWhereFields.estimated_start_date = where.estimated_start_date;
    if (where.estimated_end_date !== undefined) validWhereFields.estimated_end_date = where.estimated_end_date;
    if (where.actual_start_date !== undefined) validWhereFields.actual_start_date = where.actual_start_date;
    if (where.actual_end_date !== undefined) validWhereFields.actual_end_date = where.actual_end_date;
    if (where.production_priority !== undefined) validWhereFields.production_priority = where.production_priority;
    
    const result = await prisma.productionControl.findMany({
      where: validWhereFields,
      include: defaultInclude,
      take: perPage,
      skip
    });
    const totalRecords = await prisma.productionControl.count({ where: validWhereFields });
    return {
      data: result,
      totalRecord: totalRecords,
      page,
      perPage,
      nextPage: result.length === perPage ? `/api/production-control?page=${page + 1}` : undefined
    };
  } catch(e) {
    dbErrorHandle(e);
  }
};

const updatePartialProductionControl = async (id: number, data: UpdatePartialProductionControl): Promise<any> => {
  try {
    // Extrair campos válidos para atualização
    const {
      status,
      material_disponibility,
      estimated_start_date,
      estimated_end_date,
      actual_start_date,
      actual_end_date,
      production_priority,
      observations
    } = data;
    
    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (material_disponibility !== undefined) updateData.material_disponibility = material_disponibility;
    if (estimated_start_date !== undefined) updateData.estimated_start_date = estimated_start_date;
    if (estimated_end_date !== undefined) updateData.estimated_end_date = estimated_end_date;
    if (actual_start_date !== undefined) updateData.actual_start_date = actual_start_date;
    if (actual_end_date !== undefined) updateData.actual_end_date = actual_end_date;
    if (production_priority !== undefined) updateData.production_priority = production_priority;
    if (observations !== undefined) updateData.observations = observations;
    
    return await prisma.productionControl.update({
      where: { id },
      data: updateData,
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const deleteProductionControl = async (id: number): Promise<any> => {
  try {
    return await prisma.productionControl.delete({ 
      where: { id }, 
      include: defaultInclude
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

export default {
  createProductionControl,
  getProductionControl,
  getProductionControls,
  updatePartialProductionControl,
  deleteProductionControl
}; 