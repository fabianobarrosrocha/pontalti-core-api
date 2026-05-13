import repository from "@pontalti/repository/foam";
import { FoamRegister } from "@pontalti/types/foam.types";

const createFoam = (data: FoamRegister) => repository.createFoam(data);
const getAllFoams = () => repository.getFoams();
const getFoamById = (id: number) => repository.getFoam(id);
const updatePartialFoam = (id: number, data: Partial<FoamRegister>) =>
  repository.updatePartialFoam(id, data);
const deleteFoam = (id: number) => repository.deleteFoam(id);

export default {
  createFoam,
  getAllFoams,
  getFoamById,
  updatePartialFoam,
  deleteFoam
};
