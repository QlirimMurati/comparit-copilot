import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import type { AuthResult, PublicUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt.guard';

interface LoginBody {
  email?: string;
  password?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @ApiOperation({ summary: 'Login with email + password, returns JWT' })
  @ApiBody({
    schema: {
      example: { email: 'cm@comparit.de', password: 'admin' },
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({
    description: 'JWT + user payload',
    schema: {
      example: {
        token: 'eyJhbGciOi...',
        user: {
          id: 'uuid',
          email: 'cm@comparit.de',
          name: 'Clirim',
          role: 'admin',
        },
      },
    },
  })
  @Post('login')
  login(@Body() body: LoginBody): Promise<AuthResult> {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('email and password are required');
    }
    return this.auth.login(body.email, body.password);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Return the current authenticated user' })
  @ApiOkResponse({ description: 'Public user payload' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }
}
