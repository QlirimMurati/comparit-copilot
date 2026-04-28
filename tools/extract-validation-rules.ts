import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { glob } from 'glob';

const PROTOTYPE_ROOT = '/Users/dp/Sources/prototype-frontend';
const SEED_OUT =
  '/Users/dp/Sources/comparit-copilot/apps/api/src/validation-rules/seed';
const SHARED_HELPER_GLOBS = [
  `${PROTOTYPE_ROOT}/libs/ui/src/misc/validators.ts`,
  `${PROTOTYPE_ROOT}/libs/ui/src/misc/prefilled-control.ts`,
  `${PROTOTYPE_ROOT}/libs/comparer/src/lib/**/validators*.ts`,
  `${PROTOTYPE_ROOT}/libs/altersvorsorge/src/lib/helper-methods/manage-step-forms.ts`,
  `${PROTOTYPE_ROOT}/libs/kv/src/lib/helpers/pflegegrad-validation.ts`,
  // Cross-sparte enum models so the extractor can resolve enum values
  `${PROTOTYPE_ROOT}/libs/comparer/src/lib/comparer-interfaces/*-enum.model.ts`,
  `${PROTOTYPE_ROOT}/libs/comparer/src/lib/csi-interfaces-kfz/kfz-enums.model.ts`,
  `${PROTOTYPE_ROOT}/libs/comparer/src/lib/enums/*.ts`,
  `${PROTOTYPE_ROOT}/libs/altersvorsorge/src/lib/**/*-enum.model.ts`,
  `${PROTOTYPE_ROOT}/libs/kv/src/lib/**/*-enum.model.ts`,
  `${PROTOTYPE_ROOT}/libs/lv/src/lib/**/*-enum.model.ts`,
  `${PROTOTYPE_ROOT}/libs/sach/src/lib/**/*-enum.model.ts`,
];

const SPARTE_TO_APP: Record<string, string> = {
  Kfz: 'kfz',
  Bu: 'bu',
  Rlv: 'risikoleben',
  Pr: 'private-rente',
  Br: 'basis-rente',
  Gf: 'gf',
  Hr: 'hausrat',
  Wg: 'wohngebaeude',
  Kvv: 'kvv',
  Kvz: 'kvz',
  Phv: 'phv',
};

const FORM_FILE_GLOBS = (app: string): string[] => [
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/services/*grunddaten*.service.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/services/*deckungsumfang*.service.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/services/*leistungsumfang*.service.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/services/*ergaenzungen*.service.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/services/*ausfuhrung*.service.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/classes/*form-manager*.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/classes/*idd-form*.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/services/ValidationHelper.ts`,
  // Per-app enum models so the extractor sees the literal enum values
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/interfaces/**/*-enum.model.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/constants/**/*.ts`,
];

const PROMPT = `You are extracting validation rules from Angular reactive-form code.
For every visible form field, emit one JSON object with: fieldPath, label, type
('string'|'integer'|'number'|'boolean'|'date'|'enum'), validators (array of
{kind, value?, message?}), enumValues (only for type='enum'; null otherwise),
humanRule (one-sentence description of all constraints, mention German label
where helpful), and synonyms (3-6 alternate names: German labels, English
aliases, common abbreviations like 'DOB' for 'Geburtstag', 'KZH' for 'Karenzzeit').

Validator kinds you may use: required, min, max, minLength, maxLength, pattern,
minDate, maxDate, minAge, maxAge, custom. Use 'custom' for helpers whose
intent does not fit the others; put the helper name in 'message'.

fieldPath should be the form-control name (e.g., 'geburtsdatum') or a dotted
path if the field lives inside a nested FormGroup (e.g., 'versicherungsnehmer.geburtsdatum').

Output a single JSON array. No prose, no markdown fences. Just the array.
If you cannot find any form fields, output [].`;

interface SeedEntry {
  fieldPath: string;
  label: string;
  type: string;
  validators: { kind: string; value?: string | number; message?: string }[];
  enumValues?: string[] | null;
  humanRule: string;
  synonyms: string[];
}

async function loadSharedHelpers(): Promise<string> {
  const files = (
    await Promise.all(SHARED_HELPER_GLOBS.map((g) => glob(g)))
  ).flat();
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const f of files) {
    if (seen.has(f)) continue;
    seen.add(f);
    parts.push(`// ===== ${basename(f)} =====`);
    try {
      parts.push(readFileSync(f, 'utf8'));
    } catch {
      // skip unreadable
    }
  }
  return parts.join('\n\n');
}

async function loadSparteFiles(app: string): Promise<string> {
  const files = (
    await Promise.all(FORM_FILE_GLOBS(app).map((g) => glob(g)))
  ).flat();
  const parts: string[] = [];
  for (const f of files) {
    parts.push(`// ===== ${f.replace(PROTOTYPE_ROOT + '/', '')} =====`);
    parts.push(readFileSync(f, 'utf8'));
  }
  return parts.join('\n\n');
}

async function extractOne(
  client: Anthropic,
  helpers: string,
  sparte: string,
  app: string,
): Promise<SeedEntry[]> {
  const sparteSrc = await loadSparteFiles(app);
  if (!sparteSrc.trim()) {
    console.warn(
      `[${sparte}] no form files found under apps/${app}; skipping`,
    );
    return [];
  }
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    { type: 'text', text: PROMPT },
  ];
  if (helpers.trim().length > 0) {
    systemBlocks.push({
      type: 'text',
      text: helpers,
      cache_control: { type: 'ephemeral' },
    });
  }
  const stream = client.messages.stream({
    model: 'claude-opus-4-7',
    max_tokens: 32000,
    system: systemBlocks,
    messages: [
      {
        role: 'user',
        content: `Sparte: ${sparte}\n\nForm source:\n${sparteSrc}`,
      },
    ],
  });
  const final = await stream.finalMessage();
  const text = final.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const jsonText = text
    .replace(/^\s*```(?:json)?/, '')
    .replace(/```\s*$/, '')
    .trim();
  return JSON.parse(jsonText) as SeedEntry[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlySparte = args
    .find((a) => a.startsWith('--sparte='))
    ?.split('=')[1];
  const dryRun = args.includes('--dry-run');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY required');
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  const helpers = await loadSharedHelpers();
  console.log(`Loaded ${helpers.length} chars of shared helpers`);

  if (!dryRun) mkdirSync(SEED_OUT, { recursive: true });

  const targets = onlySparte
    ? Object.entries(SPARTE_TO_APP).filter(([s]) => s === onlySparte)
    : Object.entries(SPARTE_TO_APP);

  for (const [sparte, app] of targets) {
    console.log(`\n[${sparte}] extracting (apps/${app})…`);
    try {
      const entries = await extractOne(client, helpers, sparte, app);
      if (dryRun) {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        const out = join(SEED_OUT, `${sparte}.json`);
        writeFileSync(out, JSON.stringify(entries, null, 2) + '\n');
        console.log(`[${sparte}] wrote ${entries.length} rules → ${out}`);
      }
    } catch (err) {
      console.error(`[${sparte}] failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
