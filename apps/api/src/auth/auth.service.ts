import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { users, type User } from '../db/schema';
import type { AuthResult, JwtPayload, PublicUser } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwt: JwtService
  ) {}

  async login(email: string, password: string): Promise<AuthResult> {
    const found = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (found.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = found[0];
    const ok = await compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const token = await this.jwt.signAsync(payload);
    return { token, user: this.toPublic(user) };
  }

  async findById(id: string): Promise<PublicUser | null> {
    const found = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return found[0] ? this.toPublic(found[0]) : null;
  }

  private toPublic(u: User): PublicUser {
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  }
}
