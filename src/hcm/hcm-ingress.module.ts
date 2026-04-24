import { Module } from '@nestjs/common';
import { TimeOffModule } from '../time-off/time-off.module';
import { BatchBalanceIntakeUseCase } from './batch-balance-intake.use-case';
import { HcmModule } from './hcm.module';

/**
 * Dedicated module for HCM → service ingress flows (currently
 * just the batch balance intake).
 *
 * Sits as a distinct edge in the module graph rather than living
 * under HcmModule because the batch intake use case depends on
 * time-off repos (`BalancesRepository`,
 * `ApprovedDeductionsRepository`) as well as HCM-side ones
 * (`InconsistenciesRepository`). `TimeOffModule` already imports
 * `HcmModule` for the outbound client; having `HcmModule` reach
 * back into `TimeOffModule` would close a cycle. A third module
 * that imports both is the simplest acyclic wiring.
 */
@Module({
  imports: [HcmModule, TimeOffModule],
  providers: [BatchBalanceIntakeUseCase],
  exports: [BatchBalanceIntakeUseCase],
})
export class HcmIngressModule {}
