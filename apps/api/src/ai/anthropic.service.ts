import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class AnthropicService implements OnModuleInit {
  private readonly logger = new Logger('AnthropicService');
  private _client: Anthropic | null = null;

  onModuleInit(): void {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY is not set — AI endpoints will return a configuration error'
      );
      return;
    }
    this._client = new Anthropic({ apiKey });
    this.logger.log('Anthropic client initialised');
  }

  get client(): Anthropic {
    if (!this._client) {
      throw new Error(
        'Anthropic client is not configured. Set ANTHROPIC_API_KEY in .env to enable AI features.'
      );
    }
    return this._client;
  }

  get isConfigured(): boolean {
    return this._client !== null;
  }
}
