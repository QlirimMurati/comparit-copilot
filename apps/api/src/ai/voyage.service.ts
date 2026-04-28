import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EMBEDDING_DIMENSIONS } from '../db/schema';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const TEXT_MODEL = 'voyage-3';
const CODE_MODEL = 'voyage-code-3';

export type VoyageInputType = 'document' | 'query';

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

@Injectable()
export class VoyageService implements OnModuleInit {
  private readonly logger = new Logger('VoyageService');
  private apiKey: string | null = null;

  onModuleInit(): void {
    const key = process.env.VOYAGE_API_KEY?.trim();
    if (!key) {
      this.logger.warn(
        'VOYAGE_API_KEY is not set — embeddings will be skipped (W4/W8 features will run as no-ops)'
      );
      return;
    }
    this.apiKey = key;
    this.logger.log('Voyage client initialised');
  }

  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  async embedText(
    input: string,
    inputType: VoyageInputType = 'document'
  ): Promise<number[]> {
    return this.embed(input, TEXT_MODEL, inputType);
  }

  async embedCode(
    input: string,
    inputType: VoyageInputType = 'document'
  ): Promise<number[]> {
    return this.embed(input, CODE_MODEL, inputType);
  }

  private async embed(
    input: string,
    model: string,
    inputType: VoyageInputType
  ): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error(
        'Voyage client is not configured (set VOYAGE_API_KEY in .env)'
      );
    }
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Cannot embed empty input');
    }

    const response = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: [trimmed],
        model,
        input_type: inputType,
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '<no body>');
      throw new Error(
        `Voyage API error ${response.status}: ${text.slice(0, 500)}`
      );
    }

    const json = (await response.json()) as VoyageResponse;
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Voyage returned unexpected embedding shape (length=${vec?.length}, expected=${EMBEDDING_DIMENSIONS})`
      );
    }
    return vec;
  }
}
