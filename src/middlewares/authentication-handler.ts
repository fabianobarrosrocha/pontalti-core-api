import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import userService from "@pontalti/modules/v1/users/user-service";
import { CustomRequest } from "@pontalti/types/common.types";

const AuthenticationHandler = async (req: CustomRequest, res: Response, next: NextFunction) => {
  const path = req.path.replace(/\/+$/, "");
  if (req.method === "POST" && path === "/api/v1/authentication/login") return next();
  const match = req.header("Authorization")?.match(/^Bearer ([^\s]+)$/i);
  if (!match) return res.status(401).json({ message: "Autenticação necessária." });
  try {
    const decoded = jwt.verify(match[1], process.env.PRIVATE_KEY, { algorithms: ["HS256"] });
    if (typeof decoded === "string" || typeof decoded.email !== "string") {
      return res.status(401).json({ message: "Token inválido." });
    }
    const user = await userService.getUserByEmail(decoded.email);
    if (!user || Array.isArray(user)) return res.status(401).json({ message: "Usuário não encontrado." });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: "Token inválido ou expirado." });
  }
};

export default AuthenticationHandler;
