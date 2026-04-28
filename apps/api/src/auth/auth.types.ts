import type { UserRole } from '../db/schema';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface JwtPayload {
  sub: string;
  email: string;
}
