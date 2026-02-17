import { Status } from "./common.types";

export type Location = {
  id: number;
  name: string;
  code: string;
  status: Status;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  color: string;
  created_at: Date;
  updated_at: Date;
};

export type LocationRegister = Omit<Location, "id" | "created_at" | "updated_at">;

export type LocationRequest = Partial<Location> & {
  page?: number;
  perPage?: number;
};

export type UpdatePartialLocation = Partial<Omit<Location, "id" | "created_at" | "updated_at">>;

export type LocationPositionUpdate = {
  id: number;
  position_x: number;
  position_y: number;
};
