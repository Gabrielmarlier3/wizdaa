import { Body, Controller, Post } from '@nestjs/common';
import {
  BatchBalanceIntakeUseCase,
  BatchBalanceResult,
} from './batch-balance-intake.use-case';
import { BatchBalancePayloadDto } from './dto/batch-balance-payload.dto';

/**
 * Ingress controller for HCM → service pushes. Currently just
 * the periodic balance corpus replacement from TRD §3.3.
 */
@Controller('hcm/balances')
export class HcmIngressController {
  constructor(private readonly batchIntake: BatchBalanceIntakeUseCase) {}

  @Post('batch')
  async batch(
    @Body() payload: BatchBalancePayloadDto,
  ): Promise<BatchBalanceResult> {
    return this.batchIntake.execute(payload);
  }
}
