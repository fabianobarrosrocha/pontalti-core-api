import { NextFunction, Request, Response, Router } from "express";
import createHttpError from "http-errors";
import workHourService from "./work-hour-service";
import { CustomRequest } from "@pontalti/types/common.types";

const routes = Router();

routes.post('/', (req: CustomRequest, res: Response, next: NextFunction) => {
  workHourService.createWorkHour(req.user, req.body.datetime)
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

routes.get('/', (req: Request, res: Response, next: NextFunction) => {
  console.log(req.query)
  const { employee_id, startDate, endDate } = req.query;
  
  if (!employee_id || !startDate || !endDate) {
    const httpError = createHttpError(400, 'Missing required query parameters');
    return next(httpError);
  }

  const filters = {
    employee_id: Number(employee_id),
    startDate: new Date(startDate.toString()),
    endDate: new Date(endDate.toString())
  } 

  workHourService.getWorkHours(filters)
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

routes.get('/by-day', (req: Request, res: Response, next: NextFunction) => {
  let { day, employee_id } = req.query
  if(!day || !employee_id) return next(createHttpError(new Error("day or employee_id not provided")))

  workHourService.getEmployeeWorkHourByDay(new Date(day as string), Number(employee_id))
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

routes.get('/today', (req: Request, res: Response, next: NextFunction) => {
  workHourService.getAllWorkHoursToday()
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

// Report: Get all work hours with optional employee filter
routes.get('/report', (req: Request, res: Response, next: NextFunction) => {
  const { startDate, endDate, employee_id } = req.query;

  if (!startDate || !endDate) {
    const httpError = createHttpError(400, 'startDate e endDate sao obrigatorios');
    return next(httpError);
  }

  // Datas vêm como yyyy-MM-dd e devem ser interpretadas no fuso local do
  // servidor (não UTC) para evitar que o range volte um dia em fuso negativo.
  const parseLocalDate = (value: string): Date => {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  };

  workHourService.getWorkHoursReport(
    parseLocalDate(startDate.toString()),
    parseLocalDate(endDate.toString()),
    employee_id ? Number(employee_id) : undefined
  )
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

routes.get('/test', (req, res) => {
  res.status(200).json(req.headers);
});


routes.patch('/:id', (req, res, next) => {
  workHourService.updatePartialEmployeeWorkHour(Number(req.params.id), req.body)
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})

routes.delete('/:id', (req, res, next) => {
  workHourService.deleteEmployeeWorkHour(Number(req.params.id))
    .then(result => {
      res.json(result)
    })
    .catch(e => {
      const httpError = createHttpError(e)
      next(httpError)
    })
})


export default routes