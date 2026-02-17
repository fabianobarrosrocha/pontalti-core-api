import { Employee } from "./employee.types";

export enum TimeAdjustmentStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED"
}

export type TimeAdjustmentRequest = {
  id: number;
  employee_id: number;
  employee?: Employee;
  work_hour_id?: number | null;
  work_hour?: {
    id: number;
    clock_in: Date;
    clock_out?: Date;
  } | null;
  original_clock_in: Date;
  original_clock_out?: Date;
  proposed_clock_in?: Date;
  proposed_clock_out?: Date;
  reason?: string;
  status: TimeAdjustmentStatus;
  admin_comment?: string;
  reviewed_by?: number;
  reviewed_at?: Date;
  created_at: Date;
  updated_at: Date;
};

export type TimeAdjustmentRequestCreate = {
  employee_id: number;
  work_hour_id?: number | null;
  original_clock_in: Date | string;
  original_clock_out?: Date | string | null;
  proposed_clock_in?: Date | string | null;
  proposed_clock_out?: Date | string | null;
  reason?: string;
};

export type TimeAdjustmentRequestReview = {
  status: TimeAdjustmentStatus;
  admin_comment: string;
  reviewed_by?: number;
};
