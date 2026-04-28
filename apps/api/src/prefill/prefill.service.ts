import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { extractFirstJson, parseAndUnwrap } from './lib/parse-input';
import { loadSchema } from './lib/swagger-loader';
import {
  enums as staticEnums,
  prefillSchemas as staticPrefillSchemas,
} from './lib/schema';
import { validatePrefill } from './lib/validator';
import type {
  MissingField,
  PrefillStage,
  SparteOption,
  ValidateForChatRequest,
  ValidateForChatResponse,
  ValidateRequest,
  ValidateResponse,
} from './prefill.types';

const SPARTE_LABELS: Record<string, string> = {
  Kfz: 'KFZ-Versicherung',
  Bu: 'Berufsunfähigkeitsversicherung',
  Rlv: 'Risikolebensversicherung',
  Pr: 'Private Rentenversicherung',
  Br: 'Basis-Rentenversicherung (Rürup)',
  Gf: 'Grundfähigkeitsversicherung',
  Hr: 'Hausratversicherung',
  Wg: 'Wohngebäudeversicherung',
  Kvv: 'Krankenversicherung (Voll)',
  Kvz: 'Krankenversicherung (Zusatz)',
  Phv: 'Privathaftpflichtversicherung',
};

@Injectable()
export class PrefillService {
  private readonly logger = new Logger(PrefillService.name);

  listSparten(): SparteOption[] {
    return Object.entries(SPARTE_LABELS).map(([key, label]) => ({ key, label }));
  }

  async validate(req: ValidateRequest): Promise<ValidateResponse> {
    const stage: PrefillStage = req.stage ?? 'live';

    let source: {
      enums: typeof staticEnums;
      prefillSchemas: typeof staticPrefillSchemas;
    };
    let schemaSource: 'live' | 'static' = 'live';
    try {
      const loaded = await loadSchema(stage);
      source = {
        enums: loaded.enums,
        prefillSchemas: loaded.prefillSchemas,
      };
    } catch (err) {
      this.logger.warn(
        `Live schema load failed for stage=${stage}; using static fallback. ${
          (err as Error).message
        }`,
      );
      source = { enums: staticEnums, prefillSchemas: staticPrefillSchemas };
      schemaSource = 'static';
    }

    if (!source.prefillSchemas[req.sparte]) {
      throw new BadRequestException(
        `Unknown sparte "${req.sparte}". Valid: ${Object.keys(
          source.prefillSchemas,
        ).join(', ')}`,
      );
    }

    let data: Record<string, unknown>;
    let cleanJson: string;
    try {
      cleanJson = extractFirstJson(req.json);
      data = parseAndUnwrap(req.json);
    } catch {
      throw new BadRequestException(
        'Invalid JSON — could not extract a valid JSON object from the input',
      );
    }

    const errors = validatePrefill(req.sparte, data, source);
    return {
      valid: errors.length === 0,
      errors,
      fieldCount: Object.keys(data).length,
      cleanJson,
      stage,
      schemaSource,
    };
  }

  async validateForChat(
    req: ValidateForChatRequest,
  ): Promise<ValidateForChatResponse> {
    const stage: PrefillStage = req.stage ?? 'qa';

    let data: Record<string, unknown>;
    try {
      data = parseAndUnwrap(req.json);
    } catch {
      throw new BadRequestException(
        'Invalid JSON — could not extract a valid JSON object from the input',
      );
    }

    const fromData = typeof data['sparte'] === 'string' ? (data['sparte'] as string) : undefined;
    const wrapped = data['prefillData'];
    const fromWrapper =
      wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)
        ? typeof (wrapped as Record<string, unknown>)['sparte'] === 'string'
          ? ((wrapped as Record<string, unknown>)['sparte'] as string)
          : undefined
        : undefined;
    const detected = req.sparte ?? fromData ?? fromWrapper;
    if (!detected) {
      throw new BadRequestException('Could not detect sparte from input');
    }

    let liveSchemas:
      | Record<
          string,
          {
            fields: Record<string, unknown>;
            required?: string[];
            requiredByPath?: Record<string, string[]>;
          }
        >
      | null = null;
    let liveEnums: Record<string, readonly string[]> | null = null;
    let schemaSource: 'live' | 'static' = 'live';
    try {
      const loaded = await loadSchema(stage);
      liveSchemas = loaded.prefillSchemas;
      liveEnums = loaded.enums;
    } catch (err) {
      this.logger.warn(
        `Live schema load failed for stage=${stage}; using static fallback. ${
          (err as Error).message
        }`,
      );
      schemaSource = 'static';
    }

    const sourceForValidator =
      liveSchemas && liveEnums
        ? {
            enums: liveEnums as typeof staticEnums,
            prefillSchemas: liveSchemas as typeof staticPrefillSchemas,
          }
        : { enums: staticEnums, prefillSchemas: staticPrefillSchemas };

    if (!sourceForValidator.prefillSchemas[detected]) {
      throw new BadRequestException(
        `Unknown sparte "${detected}". Valid: ${Object.keys(
          sourceForValidator.prefillSchemas,
        ).join(', ')}`,
      );
    }

    const typeErrors = validatePrefill(detected, data, sourceForValidator);

    const missingRequired: MissingField[] = [];
    if (schemaSource === 'live' && liveSchemas) {
      const sparteSchema = liveSchemas[detected];
      const topRequired = sparteSchema.required ?? [];
      for (const key of topRequired) {
        if (data[key] === undefined || data[key] === null) {
          missingRequired.push({ path: key });
        }
      }
      const nested = sparteSchema.requiredByPath ?? {};
      for (const [parentPath, keys] of Object.entries(nested)) {
        const parent = getByPath(data, parentPath);
        if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
          const obj = parent as Record<string, unknown>;
          for (const k of keys) {
            if (obj[k] === undefined || obj[k] === null) {
              missingRequired.push({ path: `${parentPath}.${k}` });
            }
          }
        }
      }
    }

    return {
      valid: typeErrors.length === 0 && missingRequired.length === 0,
      typeErrors,
      missingRequired,
      fieldCount: Object.keys(data).length,
      stage,
      schemaSource,
      sparte: detected,
    };
  }
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (
      cur === null ||
      cur === undefined ||
      typeof cur !== 'object' ||
      Array.isArray(cur)
    ) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
