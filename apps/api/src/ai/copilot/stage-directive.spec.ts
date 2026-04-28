import { extractStageDirective } from './stage-directive';

describe('extractStageDirective', () => {
  it('parses /stage qa as { stage: "qa", cleanedText: "" }', () => {
    expect(extractStageDirective('/stage qa')).toEqual({
      stage: 'qa',
      cleanedText: '',
    });
  });

  it('is case-insensitive', () => {
    expect(extractStageDirective('/Stage LIVE')).toEqual({
      stage: 'live',
      cleanedText: '',
    });
  });

  it('keeps trailing question text', () => {
    expect(extractStageDirective('/stage live what about Kfz?')).toEqual({
      stage: 'live',
      cleanedText: 'what about Kfz?',
    });
  });

  it('returns null when no directive', () => {
    expect(extractStageDirective('paste this prefill')).toEqual({
      stage: null,
      cleanedText: 'paste this prefill',
    });
  });

  it('does not match /stagger', () => {
    expect(extractStageDirective('/stagger qa')).toEqual({
      stage: null,
      cleanedText: '/stagger qa',
    });
  });

  it('rejects unknown stage values', () => {
    expect(extractStageDirective('/stage prod')).toEqual({
      stage: null,
      cleanedText: '/stage prod',
    });
  });

  it('only strips a leading directive', () => {
    expect(extractStageDirective('hello /stage qa')).toEqual({
      stage: null,
      cleanedText: 'hello /stage qa',
    });
  });
});
