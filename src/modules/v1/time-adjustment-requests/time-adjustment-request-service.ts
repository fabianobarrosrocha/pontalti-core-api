import { TimeAdjustmentRequestCreate, TimeAdjustmentStatus, TimeAdjustmentRequestReview } from "@pontalti/types/time-adjustment-request.types";
import repository from "@pontalti/repository/time-adjustment-request";

const createRequest = async (employeeId: number, data: Omit<TimeAdjustmentRequestCreate, "employee_id">) => {
  try {
    // Validate that at least one change is proposed
    if (!data.proposed_clock_in && !data.proposed_clock_out) {
      throw new Error("Informe pelo menos uma alteracao (entrada ou saida).");
    }

    // Check if there's already a pending request for this work hour (only if editing existing)
    if (data.work_hour_id && data.work_hour_id > 0) {
      const hasPending = await repository.hasPendingRequestForWorkHour(data.work_hour_id);
      if (hasPending) {
        throw new Error("Ja existe uma solicitacao pendente para este registro de ponto.");
      }
    }

    const requestData: TimeAdjustmentRequestCreate = {
      employee_id: employeeId,
      work_hour_id: data.work_hour_id && data.work_hour_id > 0 ? data.work_hour_id : null,
      original_clock_in: data.original_clock_in,
      original_clock_out: data.original_clock_out || null,
      proposed_clock_in: data.proposed_clock_in || null,
      proposed_clock_out: data.proposed_clock_out || null,
      reason: data.reason || undefined
    };

    return await repository.createRequest(requestData);
  } catch (e) {
    throw e;
  }
};

const getMyRequests = async (employeeId: number) => {
  return await repository.getRequestsByEmployee(employeeId);
};

const getAllRequests = async (status?: string) => {
  const filters = status ? { status: status as TimeAdjustmentStatus } : undefined;
  return await repository.getAllRequests(filters);
};

const getPendingRequests = async () => {
  return await repository.getPendingRequests();
};

const getRequestById = async (id: number) => {
  return await repository.getRequestById(id);
};

const reviewRequest = async (id: number, reviewData: TimeAdjustmentRequestReview) => {
  // Validate status
  if (reviewData.status !== TimeAdjustmentStatus.APPROVED && reviewData.status !== TimeAdjustmentStatus.REJECTED) {
    throw new Error("Status invalido.");
  }

  // Check if request exists and is pending
  const request = await repository.getRequestById(id);
  if (!request) {
    throw new Error("Solicitação não encontrada.");
  }
  if (request.status !== TimeAdjustmentStatus.PENDING) {
    throw new Error("Esta solicitação já foi processada.");
  }

  return await repository.reviewRequest(
    id,
    reviewData.status,
    reviewData.admin_comment,
    reviewData.reviewed_by
  );
};

const deleteRequest = async (id: number) => {
  return await repository.deleteRequest(id);
};

export default {
  createRequest,
  getMyRequests,
  getAllRequests,
  getPendingRequests,
  getRequestById,
  reviewRequest,
  deleteRequest
};
