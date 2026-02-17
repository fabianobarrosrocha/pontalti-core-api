import { NextFunction, Request, Response, Router } from "express";
import createHttpError from "http-errors";
import service from "./time-adjustment-request-service";
import { CustomRequest } from "@pontalti/types/common.types";

const routes = Router();

// Employee: Create a new request
routes.post("/", (req: CustomRequest, res: Response, next: NextFunction) => {
  const employeeId = req.body.employee_id;

  if (!employeeId) {
    return next(createHttpError(400, "employee_id e obrigatorio"));
  }

  service.createRequest(employeeId, req.body)
    .then(result => {
      res.status(201).json(result);
    })
    .catch(e => {
      const httpError = createHttpError(400, e.message);
      next(httpError);
    });
});

// Employee: Get requests by employee ID
routes.get("/employee/:employeeId", (req: CustomRequest, res: Response, next: NextFunction) => {
  const employeeId = Number(req.params.employeeId);

  if (!employeeId) {
    return next(createHttpError(400, "employee_id é obrigatório"));
  }

  service.getMyRequests(employeeId)
    .then(result => {
      res.json(result);
    })
    .catch(e => {
      const httpError = createHttpError(e);
      next(httpError);
    });
});

// Admin: Get all requests (with optional status filter)
routes.get("/", (req: Request, res: Response, next: NextFunction) => {
  const status = req.query.status as string | undefined;

  service.getAllRequests(status)
    .then(result => {
      res.json(result);
    })
    .catch(e => {
      const httpError = createHttpError(e);
      next(httpError);
    });
});

// Admin: Get pending requests only
routes.get("/pending", (req: Request, res: Response, next: NextFunction) => {
  service.getPendingRequests()
    .then(result => {
      res.json(result);
    })
    .catch(e => {
      const httpError = createHttpError(e);
      next(httpError);
    });
});

// Get single request by ID
routes.get("/:id", (req: Request, res: Response, next: NextFunction) => {
  service.getRequestById(Number(req.params.id))
    .then(result => {
      if (!result) {
        return next(createHttpError(404, "Solicitação não encontrada"));
      }
      res.json(result);
    })
    .catch(e => {
      const httpError = createHttpError(e);
      next(httpError);
    });
});

// Admin: Review request (approve or reject)
routes.put("/:id/review", (req: CustomRequest, res: Response, next: NextFunction) => {
  const { status, admin_comment, reviewed_by } = req.body;

  if (!status) {
    return next(createHttpError(400, "status e obrigatorio"));
  }

  service.reviewRequest(Number(req.params.id), { status, admin_comment: admin_comment || "", reviewed_by })
    .then(result => {
      res.json(result);
    })
    .catch(e => {
      const httpError = createHttpError(400, e.message);
      next(httpError);
    });
});

// Delete request (optional - for admin cleanup)
routes.delete("/:id", (req: Request, res: Response, next: NextFunction) => {
  service.deleteRequest(Number(req.params.id))
    .then(result => {
      res.json(result);
    })
    .catch(e => {
      const httpError = createHttpError(e);
      next(httpError);
    });
});

export default routes;
