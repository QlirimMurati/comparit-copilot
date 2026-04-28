import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '../db/schema';
import type { PublicUser } from './auth.types';
import { ROLES_METADATA_KEY } from './roles.decorator';

interface AuthenticatedRequest extends Request {
  user?: PublicUser;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_METADATA_KEY,
      [ctx.getHandler(), ctx.getClass()]
    );
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('No authenticated user on request');
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `Requires one of roles: ${required.join(', ')}`
      );
    }
    return true;
  }
}
