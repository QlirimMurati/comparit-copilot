import { Test } from '@nestjs/testing';
import { DRIZZLE } from '../db/db.module';
import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;
  const mockDb = {
    execute: jest.fn(),
  };

  beforeAll(async () => {
    const app = await Test.createTestingModule({
      providers: [AppService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();

    service = app.get<AppService>(AppService);
  });

  describe('getHealth', () => {
    it('returns ok status', () => {
      expect(service.getHealth().status).toBe('ok');
    });

    it('returns the service name', () => {
      expect(service.getHealth().service).toBe('comparit-copilot-api');
    });

    it('returns an ISO timestamp', () => {
      const ts = service.getHealth().timestamp;
      expect(() => new Date(ts).toISOString()).not.toThrow();
    });
  });

  describe('getDbHealth', () => {
    it('returns ok when db responds', async () => {
      mockDb.execute.mockResolvedValueOnce([{ '?column?': 1 }]);
      const result = await service.getDbHealth();
      expect(result.status).toBe('ok');
    });

    it('returns down when db throws', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('connection refused'));
      const result = await service.getDbHealth();
      expect(result.status).toBe('down');
      expect(result.error).toContain('connection refused');
    });
  });
});
