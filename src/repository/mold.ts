import prisma from "@pontalti/lib/prisma";
import { Mold, MoldRegister } from "@pontalti/types/mold.types";

const createMold = async (data: MoldRegister): Promise<Mold> => {
  return await prisma.moldes.create({ data });
};

const getMolds = async (): Promise<Mold[]> => {
  return await prisma.moldes.findMany({ orderBy: { name: "asc" } });
};

const getMold = async (id: number): Promise<Mold | null> => {
  return await prisma.moldes.findUnique({ where: { id } });
};

const updatePartialMold = async (id: number, data: Partial<MoldRegister>): Promise<Mold> => {
  return await prisma.moldes.update({ where: { id }, data });
};

const deleteMold = async (id: number): Promise<Mold> => {
  return await prisma.moldes.delete({ where: { id } });
};

export default {
  createMold,
  getMolds,
  getMold,
  updatePartialMold,
  deleteMold
};
