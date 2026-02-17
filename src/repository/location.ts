import { Location, LocationRegister, LocationRequest, LocationPositionUpdate } from "@pontalti/types/location.types";
import prisma, { dbErrorHandle } from "@pontalti/lib/prisma";
import { PaginationResponse } from "@pontalti/types/common.types";

const createLocation = async (data: LocationRegister): Promise<Location> => {
  try {
    return await prisma.locations.create({ data });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getLocation = async (id: number): Promise<Location> => {
  try {
    return await prisma.locations.findUnique({
      where: { id },
      include: {
        machines: true,
        stocks: {
          include: {
            product: true
          }
        }
      }
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getLocations = async (filters: LocationRequest): Promise<PaginationResponse<Location>> => {
  try {
    const { page = 1, perPage = 100, ...where } = filters;
    const skip = page !== 1 ? (page - 1) * perPage : undefined;
    const result = await prisma.locations.findMany({
      where,
      take: perPage,
      skip,
      orderBy: { name: 'asc' }
    });
    const totalRecords = await prisma.locations.count({ where });
    return {
      data: result,
      totalRecord: totalRecords,
      page,
      perPage,
      nextPage: result.length === perPage ? `/api/locations?page=${page + 1}` : undefined
    };
  } catch(e) {
    dbErrorHandle(e);
  }
};

const getLocationsWithDetails = async () => {
  try {
    return await prisma.locations.findMany({
      where: { status: 1 },
      include: {
        machines: true,
        stocks: {
          include: {
            product: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const updatePartialLocation = async (id: number, data: Partial<Location>): Promise<Location> => {
  try {
    const { name, code, status, position_x, position_y, width, height, color } = data;
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code;
    if (status !== undefined) updateData.status = status;
    if (position_x !== undefined) updateData.position_x = position_x;
    if (position_y !== undefined) updateData.position_y = position_y;
    if (width !== undefined) updateData.width = width;
    if (height !== undefined) updateData.height = height;
    if (color !== undefined) updateData.color = color;

    return await prisma.locations.update({
      where: { id },
      data: updateData
    });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const deleteLocation = async (id: number): Promise<Location> => {
  try {
    return await prisma.locations.delete({ where: { id } });
  } catch(e) {
    dbErrorHandle(e);
  }
};

const updatePositions = async (updates: Array<{
  id: number;
  position_x: number;
  position_y: number;
  width?: number;
  height?: number;
  color?: string;
}>): Promise<void> => {
  try {
    await prisma.$transaction(
      updates.map(({ id, position_x, position_y, width, height, color }) => {
        const data: any = { position_x, position_y };
        if (width !== undefined) data.width = width;
        if (height !== undefined) data.height = height;
        if (color !== undefined) data.color = color;
        return prisma.locations.update({
          where: { id },
          data
        });
      })
    );
  } catch(e) {
    dbErrorHandle(e);
  }
};

export default {
  createLocation,
  getLocation,
  getLocations,
  getLocationsWithDetails,
  updatePartialLocation,
  deleteLocation,
  updatePositions
};
