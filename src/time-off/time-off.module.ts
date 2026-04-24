import { Module } from '@nestjs/common';
import { HcmModule } from '../hcm/hcm.module';
import { HcmOutboxWorker } from '../hcm/hcm-outbox-worker';
import { ApproveRequestUseCase } from './approve-request.use-case';
import { CancelRequestUseCase } from './cancel-request.use-case';
import { CreateRequestUseCase } from './create-request.use-case';
import { GetRequestUseCase } from './get-request.use-case';
import { RejectRequestUseCase } from './reject-request.use-case';
import { ApprovedDeductionsRepository } from './repositories/approved-deductions.repository';
import { BalancesRepository } from './repositories/balances.repository';
import { HoldsRepository } from './repositories/holds.repository';
import { RequestsRepository } from './repositories/requests.repository';
import { TimeOffController } from './time-off.controller';

/**
 * `HcmOutboxWorker` is declared in `src/hcm/` alongside the client
 * and mock — its concern is HCM integration. Provider registration
 * lives here in TimeOffModule, not HcmModule, because the worker
 * also needs `RequestsRepository` (to flip `requests.hcmSyncStatus`
 * after a push outcome). Moving that repo to HcmModule would
 * misplace a core time-off domain concern; having HcmModule import
 * TimeOffModule would create a cycle since TimeOffModule already
 * imports HcmModule for `HcmClient` and `HcmOutboxRepository`.
 */
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
    HcmOutboxWorker,
  ],
  // Exported so BalanceModule (and any future read-side module) can
  // inject the three overlay-projection repositories without
  // duplicating provider instances. HcmOutboxWorker is also exported
  // so e2e and integration tests can drive tick() manually via
  // `app.get(HcmOutboxWorker)`.
  exports: [
    BalancesRepository,
    HoldsRepository,
    ApprovedDeductionsRepository,
    HcmOutboxWorker,
  ],
})
export class TimeOffModule {}
