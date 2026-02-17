import { Machine, MachineRegister } from "@pontalti/types/machine.types";
import { CommonRequest } from "@pontalti/types/common.types";
import prisma from "@pontalti/lib/prisma";

const createMachine = async (data: MachineRegister) => {
  return await prisma.machines.create({ 
    data: {
      ...data,
      created_at: new Date(),
      updated_at: new Date()
    } 
  });
};

const getMachine = async (id: number) => {
  return await prisma.machines.findUnique({
    where: { id },
    include: { location: true }
  });
};

const getMachines = async (filters: CommonRequest<Machine>) => {
  const { page, perPage } = filters;
  const skip = page !== 1 && page != undefined ? (page - 1) * perPage : undefined;
  return await prisma.machines.findMany({
    take: perPage,
    skip: skip,
    include: { location: true }
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updatePartialMachine = async (id: number, data: any) => {
  const existingMachine = await prisma.machines.findUnique({
    where: { id }
  });

  if (!existingMachine) {
    throw new Error("Machine not found");
  }

  const updatedMachine = await prisma.machines.update({
    where: { id },
    data: {
      ...existingMachine,
      ...data,
      updated_at: new Date()
    }
  });

  return updatedMachine;
};

const deleteMachine = async (id: number) => {
  return await prisma.machines.delete({ where: { id } });
};

export default {
  createMachine,
  getMachine,
  getMachines,
  updatePartialMachine,
  deleteMachine
};
