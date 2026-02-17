import { TimeAdjustmentRequest, TimeAdjustmentRequestCreate, TimeAdjustmentStatus } from "@pontalti/types/time-adjustment-request.types";
import prisma from "@pontalti/lib/prisma";

const createRequest = async (data: TimeAdjustmentRequestCreate): Promise<TimeAdjustmentRequest> => {
  const createData: any = {
    employee: {
      connect: { id: data.employee_id }
    },
    original_clock_in: new Date(data.original_clock_in),
    original_clock_out: data.original_clock_out ? new Date(data.original_clock_out) : null,
    proposed_clock_in: data.proposed_clock_in ? new Date(data.proposed_clock_in) : null,
    proposed_clock_out: data.proposed_clock_out ? new Date(data.proposed_clock_out) : null,
    reason: data.reason || null,
    status: TimeAdjustmentStatus.PENDING
  };

  // Somente conecta work_hour se existir
  if (data.work_hour_id && data.work_hour_id > 0) {
    createData.work_hour = {
      connect: { id: data.work_hour_id }
    };
  }

  return await prisma.timeAdjustmentRequest.create({
    data: createData,
    include: {
      employee: true,
      work_hour: true
    }
  }) as unknown as TimeAdjustmentRequest;
};

const getRequestById = async (id: number) => {
  return await prisma.timeAdjustmentRequest.findUnique({
    where: { id },
    include: {
      employee: true,
      work_hour: true
    }
  });
};

const getRequestsByEmployee = async (employeeId: number) => {
  return await prisma.timeAdjustmentRequest.findMany({
    where: { employee_id: employeeId },
    include: {
      employee: true,
      work_hour: true
    },
    orderBy: { created_at: "desc" }
  });
};

const getAllRequests = async (filters?: { status?: TimeAdjustmentStatus }) => {
  const whereClause = filters?.status ? { status: filters.status } : {};

  return await prisma.timeAdjustmentRequest.findMany({
    where: whereClause,
    include: {
      employee: true,
      work_hour: true
    },
    orderBy: { created_at: "desc" }
  });
};

const getPendingRequests = async () => {
  return await prisma.timeAdjustmentRequest.findMany({
    where: { status: TimeAdjustmentStatus.PENDING },
    include: {
      employee: true,
      work_hour: true
    },
    orderBy: { created_at: "desc" }
  });
};

const reviewRequest = async (
  id: number,
  status: TimeAdjustmentStatus,
  adminComment: string,
  reviewedBy?: number
) => {
  return await prisma.timeAdjustmentRequest.update({
    where: { id },
    data: {
      status: status,
      admin_comment: adminComment,
      reviewed_by: reviewedBy || null,
      reviewed_at: new Date()
    },
    include: {
      employee: true,
      work_hour: true
    }
  });
};

const deleteRequest = async (id: number) => {
  return await prisma.timeAdjustmentRequest.delete({
    where: { id }
  });
};

const hasPendingRequestForWorkHour = async (workHourId: number) => {
  const existing = await prisma.timeAdjustmentRequest.findFirst({
    where: {
      work_hour_id: workHourId,
      status: TimeAdjustmentStatus.PENDING
    }
  });
  return !!existing;
};

export default {
  createRequest,
  getRequestById,
  getRequestsByEmployee,
  getAllRequests,
  getPendingRequests,
  reviewRequest,
  deleteRequest,
  hasPendingRequestForWorkHour
};
