import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hash } from 'bcryptjs';
import { DRIZZLE } from '../db/db.module';
import { AuthService } from './auth.service';

function dbReturning(rows: unknown[]) {
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  };
}

describe('AuthService', () => {
  const jwt = new JwtService({
    secret: 'test-secret',
    signOptions: { expiresIn: '1h' },
  });

  it('login signs a JWT for valid credentials', async () => {
    const passwordHash = await hash('hunter2', 10);
    const db = dbReturning([
      {
        id: 'u-1',
        email: 'admin@comparit.de',
        passwordHash,
        name: 'Admin',
        role: 'admin',
      },
    ]);
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DRIZZLE, useValue: db },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    const svc = module.get(AuthService);

    const out = await svc.login('admin@comparit.de', 'hunter2');

    expect(out.token).toEqual(expect.any(String));
    const payload = await jwt.verifyAsync(out.token);
    expect(payload).toMatchObject({ sub: 'u-1', email: 'admin@comparit.de' });
    expect(out.user).toEqual({
      id: 'u-1',
      email: 'admin@comparit.de',
      name: 'Admin',
      role: 'admin',
    });
  });

  it('login rejects unknown email', async () => {
    const db = dbReturning([]);
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DRIZZLE, useValue: db },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    const svc = module.get(AuthService);
    await expect(svc.login('nope@x', 'pw')).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('login rejects wrong password', async () => {
    const passwordHash = await hash('hunter2', 10);
    const db = dbReturning([
      {
        id: 'u-1',
        email: 'admin@comparit.de',
        passwordHash,
        name: 'Admin',
        role: 'admin',
      },
    ]);
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DRIZZLE, useValue: db },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    const svc = module.get(AuthService);
    await expect(svc.login('admin@comparit.de', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('findById returns the public user shape', async () => {
    const db = dbReturning([
      {
        id: 'u-2',
        email: 'q@a',
        passwordHash: 'x',
        name: 'Q',
        role: 'tester',
      },
    ]);
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DRIZZLE, useValue: db },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    const svc = module.get(AuthService);
    const user = await svc.findById('u-2');
    expect(user).toEqual({ id: 'u-2', email: 'q@a', name: 'Q', role: 'tester' });
  });
});
