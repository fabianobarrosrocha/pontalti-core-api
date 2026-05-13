import repository from "@pontalti/repository/mold";
import { MoldRegister } from "@pontalti/types/mold.types";

const createMold = (data: MoldRegister) => repository.createMold(data);
const getAllMolds = () => repository.getMolds();
const getMoldById = (id: number) => repository.getMold(id);
const updatePartialMold = (id: number, data: Partial<MoldRegister>) =>
  repository.updatePartialMold(id, data);
const deleteMold = (id: number) => repository.deleteMold(id);

export default {
  createMold,
  getAllMolds,
  getMoldById,
  updatePartialMold,
  deleteMold
};
