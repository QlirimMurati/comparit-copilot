import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { extractFirstJson, parseAndUnwrap } from './lib/parse-input';
import { loadSchema } from './lib/swagger-loader';
import {
  enums as staticEnums,
  prefillSchemas as staticPrefillSchemas,
} from './lib/schema';
import { validatePrefill } from './lib/validator';
import type {
  PrefillStage,
  SparteOption,
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
}
