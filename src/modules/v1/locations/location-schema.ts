import * as yup from "yup";
import { Status } from "@pontalti/types/common.types";

export const locationSchema = yup.object().shape({
  name: yup.string().required("Nome é obrigatório"),
  code: yup.string().required("Código é obrigatório"),
  status: yup.mixed<Status>().oneOf([Status.Suspenso, Status.Operacional]).default(Status.Operacional),
  position_x: yup.number().default(0),
  position_y: yup.number().default(0),
  width: yup.number().default(100).min(50, "Largura mínima 50px"),
  height: yup.number().default(100).min(50, "Altura mínima 50px"),
  color: yup.string().default("#3b82f6")
});

export const locationUpdateSchema = yup.object().shape({
  name: yup.string(),
  code: yup.string(),
  status: yup.mixed<Status>().oneOf([Status.Suspenso, Status.Operacional]),
  position_x: yup.number(),
  position_y: yup.number(),
  width: yup.number().min(50, "Largura mínima 50px"),
  height: yup.number().min(50, "Altura mínima 50px"),
  color: yup.string()
});

export const locationPositionUpdateSchema = yup.object().shape({
  updates: yup.array().of(
    yup.object().shape({
      id: yup.number().required(),
      position_x: yup.number().required(),
      position_y: yup.number().required()
    })
  ).required()
});
