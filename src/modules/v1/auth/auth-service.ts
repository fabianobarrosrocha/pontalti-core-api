import { RegisterUser, User } from "@pontalti/types/user.types";
import { DefaultResponse } from "@pontalti/types/common.types";
import jwt from "jsonwebtoken";
import repository from "@pontalti/repository/user";
import bcrypt, { compare } from "bcrypt";
import { BadRequestError, NotFoundError, UnauthorizedError } from "@pontalti/utils/errors";
import { passwordMessage, passwordRegex } from "@pontalti/modules/v1/users/user-schema";

const register = async (data: RegisterUser) => {
  try {
    const passwordHash = await bcrypt.hash(data.password, 10);
    data.password = passwordHash;

    const response = await repository.registerUser(data);
    const { password, ...userWithoutPassword } = response;
    return { data: userWithoutPassword } as DefaultResponse;
  } catch (e) {
    throw e;
  }
};

const login = async (email: string, password: string) => {
  try {
    const user = await repository.getUserByEmail(email);

    if (!user) {
      throw new UnauthorizedError("Credenciais inválidas. Verifique o email e senha e tente novamente.");
    }

    const passwordMatched = await compare(password, user.password);

    if (!passwordMatched) {
      throw new UnauthorizedError("Credenciais inválidas. Verifique o email e senha e tente novamente.");
    }

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.PRIVATE_KEY, {
      expiresIn: "1d"
    });
    return { token, user };
  } catch (e) {
    throw e;
  }
};

const changePassword = async (newPassword: string, token: string) => {
  try {
    if (!passwordRegex.test(newPassword)) throw new BadRequestError(passwordMessage);

    const email = jwt.decode(token)["email"];
    if (!email) throw new BadRequestError("Email não encontrado no token jwt.");

    const user = await repository.getUserByEmail(email);
    if (!user) throw new NotFoundError("Não foi possível encontrar o usuário, tente novamente mais tarde");

    const passwordHash = await bcrypt.hash(newPassword, 10);
    user.password = passwordHash;

    const { password, ...userWithoutPassword } = await repository.updateUser(user.id, user);
    return { data: userWithoutPassword } as DefaultResponse;
  } catch (e) {
    throw e;
  }
};

export default {
  register,
  login,
  changePassword
};
