import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PrefillController } from './prefill.controller';
import { PrefillService } from './prefill.service';

describe('PrefillController', () => {
  const mockService = {
    listSparten: jest
      .fn()
      .mockReturnValue([{ key: 'Kfz', label: 'KFZ-Versicherung' }]),
    validate: jest.fn().mockResolvedValue({
      valid: true,
      errors: [],
      fieldCount: 1,
      cleanJson: '{}',
      stage: 'live',
      schemaSource: 'live',
    }),
  };

  async function build(): Promise<PrefillController> {
    const moduleRef = await Test.createTestingModule({
      controllers: [PrefillController],
      providers: [{ provide: PrefillService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    return moduleRef.get(PrefillController);
  }

  beforeEach(() => jest.clearAllMocks());

  it('GET /sparten delegates to service', async () => {
    const ctrl = await build();
    expect(ctrl.listSparten()).toEqual([
      { key: 'Kfz', label: 'KFZ-Versicherung' },
    ]);
    expect(mockService.listSparten).toHaveBeenCalled();
  });

  it('POST /validate delegates to service', async () => {
    const ctrl = await build();
    const result = await ctrl.validate({
      sparte: 'Kfz',
      json: '{}',
      stage: 'live',
    });
    expect(result.valid).toBe(true);
    expect(mockService.validate).toHaveBeenCalledWith({
      sparte: 'Kfz',
      json: '{}',
      stage: 'live',
    });
  });
});
