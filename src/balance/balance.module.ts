import { Module } from '@nestjs/common';
import { TimeOffModule } from '../time-off/time-off.module';
import { BalanceController } from './balance.controller';
import { GetBalanceUseCase } from './get-balance.use-case';

/**
 * Read-side projection module per TRD §2 architecture diagram.
 * Consumes the overlay repositories exported by `TimeOffModule`
 * (BalancesRepository, HoldsRepository, ApprovedDeductionsRepository)
 * without duplicating provider instances.
 */
@Module({
  imports: [TimeOffModule],
  controllers: [BalanceController],
  providers: [GetBalanceUseCase],
})
export class BalanceModule {}
