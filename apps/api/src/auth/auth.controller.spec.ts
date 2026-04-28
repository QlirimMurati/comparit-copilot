import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController.login', () => {
  let controller: AuthController;
  const login = jest.fn();
  const findById = jest.fn();

  beforeEach(async () => {
    login.mockReset();
    findById.mockReset();
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: { login, findById } },
        // The `@UseGuards(JwtAuthGuard)` on `me()` transitively pulls JwtService
        // into the testing module even when we never invoke `me()`.
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
      ],
    }).compile();
    controller = module.get(AuthController);
  });

  it('returns the AuthService result on success', async () => {
    const stub = {
      token: 'tok',
      user: { id: 'u', email: 'a@b', name: 'A', role: 'admin' as const },
    };
    login.mockResolvedValueOnce(stub);
    const out = await controller.login({ email: 'a@b', password: 'pw' });
    expect(out).toBe(stub);
    expect(login).toHaveBeenCalledWith('a@b', 'pw');
  });

  it('rejects missing email', async () => {
    await expect(controller.login({ password: 'pw' })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(login).not.toHaveBeenCalled();
  });

  it('rejects missing password', async () => {
    await expect(controller.login({ email: 'a@b' })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(login).not.toHaveBeenCalled();
  });

  it('propagates UnauthorizedException from the service', async () => {
    login.mockRejectedValueOnce(new UnauthorizedException('Invalid credentials'));
    await expect(
      controller.login({ email: 'a@b', password: 'wrong' })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
