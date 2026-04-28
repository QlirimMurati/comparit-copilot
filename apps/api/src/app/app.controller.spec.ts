import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE } from '../db/db.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;
  const mockDb = { execute: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
  });

  describe('getHealth', () => {
    it('returns ok status with service metadata', () => {
      const controller = app.get<AppController>(AppController);
      const result = controller.getHealth();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('comparit-copilot-api');
      expect(typeof result.version).toBe('string');
      expect(typeof result.timestamp).toBe('string');
    });
  });

  describe('getDbHealth', () => {
    it('returns ok when db query succeeds', async () => {
      const controller = app.get<AppController>(AppController);
      const result = await controller.getDbHealth();
      expect(result.status).toBe('ok');
    });
  });
});
