export type AccessLevel = "administrator" | "standard";

export type User = {
  id: number;
  email: string;
  password: string;
  name: string;
  access_level: AccessLevel;
};

export type RegisterUser = {
  name: string;
  email: string;
  password: string;
  access_level: AccessLevel;
};
