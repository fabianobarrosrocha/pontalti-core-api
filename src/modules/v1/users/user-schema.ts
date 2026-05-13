import * as yup from "yup";

const passwordMessage =
  "Password must be at least 8 characters and include uppercase, lowercase, number and special character";
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const ACCESS_LEVELS = ["administrator", "standard"] as const;

const createUserSchema = yup.object({
  body: yup.object({
    name: yup.string().required(),
    email: yup.string().required(),
    password: yup.string().required().matches(passwordRegex, passwordMessage),
    access_level: yup.string().oneOf([...ACCESS_LEVELS]).required("Informe o nível de acesso.")
  })
});

const updateUserSchema = yup.object({
  body: yup.object({
    name: yup.string().optional(),
    email: yup.string().optional(),
    password: yup
      .string()
      .optional()
      .transform((value) => (value === "" ? undefined : value))
      .matches(passwordRegex, passwordMessage),
    access_level: yup.string().oneOf([...ACCESS_LEVELS]).optional()
  })
});

export { createUserSchema, updateUserSchema, passwordRegex, passwordMessage, ACCESS_LEVELS };
