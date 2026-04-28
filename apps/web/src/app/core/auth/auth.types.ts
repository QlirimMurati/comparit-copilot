export type UserRole = 'dev' | 'qa' | 'po' | 'qa_lead' | 'admin';

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
