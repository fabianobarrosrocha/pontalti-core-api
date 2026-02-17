import { Router } from "express";
import createHttpError from "http-errors";
import userService from "@pontalti/modules/v1/users/user-service";

const router = Router();

router.post('/', (req, res, next) => {
  userService.createUser(req.body)
    .then(result => {
      res.status(201).json(result);
    })
    .catch(e => {
      const httpError = createHttpError(e);
      next(httpError);
    })
})

router.patch('/:id', (req, res, next) => {
  userService.updatePartialUser(Number(req.params.id), req.body)
    .then(result => {
      res.json(result);
    })
    .catch(e => {
      const httpError = createHttpError(e);
      next(httpError);
    })
})

router.get('/email', (req, res, next) => {
  userService.getUserByEmail(req.body.email)
    .then(result => {
      res.json(result);
    })
    .catch(e => {
      const httpError = createHttpError(e);
      next(httpError);
    })
})

router.get('/', (req, res, next) => {
  userService.getAllUsers()
    .then(result => {
      res.json(result);
    })
    .catch(e => {
      const httpError = createHttpError(e);
      next(httpError);
    })
})

router.delete('/:id', (req, res, next) => {
  userService.deleteUser(Number(req.params.id))
    .then(result => {
      res.json(result);
    })
    .catch(e => {
      const httpError = createHttpError(e);
      next(httpError);
    })
})

export default router