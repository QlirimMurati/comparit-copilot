const STAGE_DIRECTIVE = /^\s*\/stage\s+(live|qa|dev)\b\s*/i;

export function extractStageDirective(text: string): {
  stage: 'live' | 'qa' | 'dev' | null;
  cleanedText: string;
} {
  const match = STAGE_DIRECTIVE.exec(text);
  if (!match) return { stage: null, cleanedText: text };
  const stage = match[1].toLowerCase() as 'live' | 'qa' | 'dev';
  const cleaned = text.replace(STAGE_DIRECTIVE, '').trim();
  return { stage, cleanedText: cleaned };
}
