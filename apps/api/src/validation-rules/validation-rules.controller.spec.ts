import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ValidationRulesController } from './validation-rules.controller';
import { ValidationRulesService } from './validation-rules.service';

describe('ValidationRulesController', () => {
  const mockService = {
    list: jest.fn().mockResolvedValue([]),
    getById: jest
      .fn()
      .mockResolvedValue({
        id: 'r1',
        sparte: 'Kfz',
        fieldPath: 'foo',
        label: 'Foo',
        type: 'string',
        validators: [],
        enumValues: null,
        humanRule: 'x',
        synonyms: [],
        source: 'seed',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    upsert: jest.fn().mockResolvedValue({ id: 'r2', sparte: 'Kfz' }),
    addSynonym: jest.fn().mockResolvedValue({ id: 'r1', synonyms: ['x'] }),
    delete: jest.fn().mockResolvedValue(undefined),
  };

  async function build(): Promise<ValidationRulesController> {
    const moduleRef = await Test.createTestingModule({
      controllers: [ValidationRulesController],
      providers: [{ provide: ValidationRulesService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    return moduleRef.get(ValidationRulesController);
  }

  beforeEach(() => jest.clearAllMocks());

  it('GET / forwards the filter to service.list', async () => {
    const ctrl = await build();
    await ctrl.list('Kfz', 'geburtsdatum');
    expect(mockService.list).toHaveBeenCalledWith({
      sparte: 'Kfz',
      query: 'geburtsdatum',
    });
  });

  it('GET /:id forwards to getById', async () => {
    const ctrl = await build();
    const res = await ctrl.getById('r1');
    expect(res.id).toBe('r1');
  });

  it('POST /:id/synonyms forwards to addSynonym', async () => {
    const ctrl = await build();
    await ctrl.addSynonym('r1', { synonym: 'birthdate' });
    expect(mockService.addSynonym).toHaveBeenCalledWith('r1', 'birthdate');
  });

  it('POST / upserts a manual rule', async () => {
    const ctrl = await build();
    await ctrl.create({
      sparte: 'Kfz',
      fieldPath: 'foo',
      label: 'Foo',
      type: 'string',
      validators: [],
      humanRule: 'x',
    });
    expect(mockService.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ sparte: 'Kfz', fieldPath: 'foo' }),
      'manual',
    );
  });
});
