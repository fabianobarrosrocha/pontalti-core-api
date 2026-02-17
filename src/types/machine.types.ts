import { Status } from "./common.types";
import { Location } from "./location.types";

export type Machine = {
  id: number;
  model: string;
  machine_number: number;
  status: Status;
  location_id?: number | null;
  location_status: Status;
  location?: Location | null;
  created_at: Date;
  updated_at: Date;
};

export type MachineRegister = Omit<Machine, "id" | "created_at" | "updated_at" | "location">;
