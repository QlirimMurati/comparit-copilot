import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class BasicAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Basic ')) {
      throw new UnauthorizedException('Basic auth required');
    }
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep < 0) {
      throw new UnauthorizedException('Malformed basic auth');
    }
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);

    const expectedUser = process.env.WIDGET_BASIC_USER ?? 'widget';
    const expectedPass = process.env.WIDGET_BASIC_PASS ?? 'local';

    if (user !== expectedUser || pass !== expectedPass) {
      throw new UnauthorizedException('Invalid widget credentials');
    }
    return true;
  }
}
