import { Module } from '@nestjs/common';
import { HcmModule } from '../hcm/hcm.module';
import { ApproveRequestUseCase } from './approve-request.use-case';
import { CancelRequestUseCase } from './cancel-request.use-case';
import { CreateRequestUseCase } from './create-request.use-case';
import { GetRequestUseCase } from './get-request.use-case';
import { RejectRequestUseCase } from './reject-request.use-case';
import { ApprovedDeductionsRepository } from './repositories/approved-deductions.repository';
import { BalancesRepository } from './repositories/balances.repository';
import { HcmOutboxRepository } from './repositories/hcm-outbox.repository';
import { HoldsRepository } from './repositories/holds.repository';
import { RequestsRepository } from './repositories/requests.repository';
import { TimeOffController } from './time-off.controller';

@Module({
  imports: [HcmModule],
  controllers: [TimeOffController],
  providers: [
    CreateRequestUseCase,
    ApproveRequestUseCase,
    RejectRequestUseCase,
    CancelRequestUseCase,
    GetRequestUseCase,
    RequestsRepository,
    HoldsRepository,
    BalancesRepository,
    ApprovedDeductionsRepository,
    HcmOutboxRepository,
  ],
  // Exported so BalanceModule (and any future read-side module)
  // can inject the three overlay-projection repositories without
  // duplicating provider instances.
  exports: [
    BalancesRepository,
    HoldsRepository,
    ApprovedDeductionsRepository,
  ],
})
export class TimeOffModule {}
