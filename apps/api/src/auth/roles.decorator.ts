import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../db/schema';

export const ROLES_METADATA_KEY = 'roles';

export const Roles = (...roles: UserRole[]) =>
  SetMetadata(ROLES_METADATA_KEY, roles);
