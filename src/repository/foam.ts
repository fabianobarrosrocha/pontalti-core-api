import prisma from "@pontalti/lib/prisma";
import { Foam, FoamRegister } from "@pontalti/types/foam.types";

const createFoam = async (data: FoamRegister): Promise<Foam> => {
  return await prisma.espumas.create({ data });
};

const getFoams = async (): Promise<Foam[]> => {
  return await prisma.espumas.findMany({ orderBy: { name: "asc" } });
};

const getFoam = async (id: number): Promise<Foam | null> => {
  return await prisma.espumas.findUnique({ where: { id } });
};

const updatePartialFoam = async (id: number, data: Partial<FoamRegister>): Promise<Foam> => {
  return await prisma.espumas.update({ where: { id }, data });
};

const deleteFoam = async (id: number): Promise<Foam> => {
  return await prisma.espumas.delete({ where: { id } });
};

export default {
  createFoam,
  getFoams,
  getFoam,
  updatePartialFoam,
  deleteFoam
};
