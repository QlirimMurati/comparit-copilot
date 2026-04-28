import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PrefillService } from './prefill.service';
import type {
  SparteOption,
  ValidateRequest,
  ValidateResponse,
} from './prefill.types';

@ApiTags('prefill')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('prefill')
export class PrefillController {
  constructor(private readonly svc: PrefillService) {}

  @ApiOperation({ summary: 'List sparten with German labels' })
  @Get('sparten')
  listSparten(): SparteOption[] {
    return this.svc.listSparten();
  }

  @ApiOperation({
    summary: 'Validate a prefill JSON payload against a sparte schema',
  })
  @Post('validate')
  validate(@Body() body: ValidateRequest): Promise<ValidateResponse> {
    return this.svc.validate(body);
  }
}
