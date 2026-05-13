import { User, RegisterUser } from "@pontalti/types/user.types";
import repository from "@pontalti/repository/user";
import bcrypt from 'bcrypt'

const removePassword = (u: User | User[]) => {
  if(!u) return u
  if (Array.isArray(u)){
    const data = u.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });
    return data;
  }

  const { password, ...userWithoutPassword } = u
  return userWithoutPassword
}

const createUser = async (data: RegisterUser) => {
  try {
    const passwordHash = await bcrypt.hash(data.password, 10);
    const userData = { ...data, password: passwordHash };
    const userResponse = await repository.registerUser(userData);
    return removePassword(userResponse);
  } catch(e) {
    throw e;
  }
}

const getAllUsers = async () => {
  try {
    const userResponse = removePassword(await repository.getAllUsers());
    return userResponse;
  } catch(e) {
    throw e
  }
}

const getUserByEmail = async (email: string) => {
  try {
    const userResponse = removePassword(await repository.getUserByEmail(email))
    return userResponse;
  } catch(e) {
    throw e
  }
}

const getUserById = async (id: number) => {
  try {
    const userResponse = removePassword(await repository.getUserById(id))
    return userResponse;
  } catch(e) {
    throw e
  }
}

const updatePartialUser = async (id: number, data: Partial<User>) => {
  try {
    // Remove password from update if it's empty or undefined
    if (!data.password || data.password.trim() === '') {
      delete data.password;
    } else {
      const passwordHash = await bcrypt.hash(data.password, 10);
      data.password = passwordHash;
    }
    const userResponse = await repository.updatePartialUser(id, data)
    return removePassword(userResponse)
  } catch(e) {
    throw e
  }
}

const deleteUser = async (id: number) => {
  try {
    const userResponse = await repository.deleteUser(id)
    return removePassword(userResponse)
  } catch(e) {
    throw e
  }
}

export default {
  createUser,
  getAllUsers,
  getUserByEmail,
  getUserById,
  updatePartialUser,
  deleteUser
}