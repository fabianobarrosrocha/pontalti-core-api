import { NextFunction, Response } from "express";
import { CustomRequest } from "@pontalti/types/common.types";

export function requireAdmin(req: CustomRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ message: "Autenticação necessária." });
  if (req.user.access_level !== "administrator") {
    return res.status(403).json({ message: "Acesso restrito a administradores." });
  }
  next();
}
