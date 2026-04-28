import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthResult, PublicUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt.guard';

interface LoginBody {
  email?: string;
  password?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: LoginBody): Promise<AuthResult> {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('email and password are required');
    }
    return this.auth.login(body.email, body.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }
}
