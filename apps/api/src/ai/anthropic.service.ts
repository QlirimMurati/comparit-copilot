import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

// Direct Anthropic API. Earlier this file held a Bedrock-Nova adapter that
// translated SDK calls to AWS Bedrock's Converse API; that path is disabled
// now that ANTHROPIC_API_KEY is provisioned. To switch back, see git history
// (commit 7cdf557 added the Bedrock adapter; this commit reverts to direct).

@Injectable()
export class AnthropicService implements OnModuleInit {
  private readonly logger = new Logger('AnthropicService');
  private _client: Anthropic | null = null;

  onModuleInit(): void {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — AI endpoints will return a configuration error'
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
