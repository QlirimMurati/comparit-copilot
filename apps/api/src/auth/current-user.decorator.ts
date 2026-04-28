import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { PublicUser } from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  }
);
