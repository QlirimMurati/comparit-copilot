import { Test } from '@nestjs/testing';
import { WidgetController } from './widget.controller';
import { WidgetService } from './widget.service';

describe('WidgetController', () => {
  let controller: WidgetController;
  const submit = jest.fn();

  beforeEach(async () => {
    submit.mockReset();
    const module = await Test.createTestingModule({
      controllers: [WidgetController],
      providers: [{ provide: WidgetService, useValue: { submit } }],
    }).compile();
    controller = module.get(WidgetController);
  });

  it('delegates to WidgetService.submit and returns the shaped result', async () => {
    const stubResult = {
      id: 'r-1',
      status: 'open',
      createdAt: '2026-01-15T10:00:00Z',
    };
    submit.mockResolvedValueOnce(stubResult);

    const result = await controller.submit({
      title: 'broken page',
      description: 'detailed description here',
      reporterEmail: 'qa@comparit.de',
    });

    expect(result).toBe(stubResult);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ reporterEmail: 'qa@comparit.de' })
    );
  });

  it('propagates service errors', async () => {
    submit.mockRejectedValueOnce(new Error('db down'));
    await expect(
      controller.submit({
        title: 'broken page',
        description: 'detailed description here',
        reporterEmail: 'qa@comparit.de',
      })
    ).rejects.toThrow('db down');
  });
});
