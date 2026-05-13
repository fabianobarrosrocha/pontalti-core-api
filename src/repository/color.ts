import prisma from "@pontalti/lib/prisma";
import { Color, ColorRegister } from "@pontalti/types/color.types";

const createColor = async (data: ColorRegister): Promise<Color> => {
  return await prisma.cores.create({ data });
};

const getColors = async (): Promise<Color[]> => {
  return await prisma.cores.findMany({ orderBy: { name: "asc" } });
};

const getColor = async (id: number): Promise<Color | null> => {
  return await prisma.cores.findUnique({ where: { id } });
};

const updatePartialColor = async (id: number, data: Partial<ColorRegister>): Promise<Color> => {
  return await prisma.cores.update({ where: { id }, data });
};

const deleteColor = async (id: number): Promise<Color> => {
  return await prisma.cores.delete({ where: { id } });
};

export default {
  createColor,
  getColors,
  getColor,
  updatePartialColor,
  deleteColor
};
