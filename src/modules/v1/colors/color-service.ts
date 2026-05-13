import repository from "@pontalti/repository/color";
import { Color, ColorRegister } from "@pontalti/types/color.types";

const createColor = (data: ColorRegister) => repository.createColor(data);
const getAllColors = () => repository.getColors();
const getColorById = (id: number) => repository.getColor(id);
const updatePartialColor = (id: number, data: Partial<ColorRegister>) =>
  repository.updatePartialColor(id, data);
const deleteColor = (id: number) => repository.deleteColor(id);

export default {
  createColor,
  getAllColors,
  getColorById,
  updatePartialColor,
  deleteColor
};
