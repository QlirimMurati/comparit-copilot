import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BasicAuthGuard } from './basic-auth.guard';

function makeCtx(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authHeader ? { authorization: authHeader } : {} }),
    }),
  } as unknown as ExecutionContext;
}

describe('BasicAuthGuard', () => {
  let guard: BasicAuthGuard;
  const originalUser = process.env.WIDGET_BASIC_USER;
  const originalPass = process.env.WIDGET_BASIC_PASS;

  beforeEach(() => {
    guard = new BasicAuthGuard();
    process.env.WIDGET_BASIC_USER = 'widget';
    process.env.WIDGET_BASIC_PASS = 'local';
  });

  afterAll(() => {
    if (originalUser === undefined) delete process.env.WIDGET_BASIC_USER;
    else process.env.WIDGET_BASIC_USER = originalUser;
    if (originalPass === undefined) delete process.env.WIDGET_BASIC_PASS;
    else process.env.WIDGET_BASIC_PASS = originalPass;
  });

  it('rejects when no auth header is present', () => {
    expect(() => guard.canActivate(makeCtx())).toThrow(UnauthorizedException);
  });

  it('rejects when scheme is not Basic', () => {
    expect(() => guard.canActivate(makeCtx('Bearer abc'))).toThrow(UnauthorizedException);
  });

  it('rejects malformed credentials (no colon)', () => {
    const encoded = Buffer.from('justuser', 'utf8').toString('base64');
    expect(() => guard.canActivate(makeCtx(`Basic ${encoded}`))).toThrow(
      UnauthorizedException
    );
  });

  it('rejects wrong password', () => {
    const encoded = Buffer.from('widget:wrong', 'utf8').toString('base64');
    expect(() => guard.canActivate(makeCtx(`Basic ${encoded}`))).toThrow(
      UnauthorizedException
    );
  });

  it('accepts the configured widget credentials', () => {
    const encoded = Buffer.from('widget:local', 'utf8').toString('base64');
    expect(guard.canActivate(makeCtx(`Basic ${encoded}`))).toBe(true);
  });

  it('honors WIDGET_BASIC_USER / WIDGET_BASIC_PASS overrides', () => {
    process.env.WIDGET_BASIC_USER = 'svc';
    process.env.WIDGET_BASIC_PASS = 's3cret';
    const encoded = Buffer.from('svc:s3cret', 'utf8').toString('base64');
    expect(guard.canActivate(makeCtx(`Basic ${encoded}`))).toBe(true);
  });
});
