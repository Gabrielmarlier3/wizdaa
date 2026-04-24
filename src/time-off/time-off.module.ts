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
import { HcmOutboxRepository } from './repositories/hcm-outbox.repository';
import { HoldsRepository } from './repositories/holds.repository';
import { RequestsRepository } from './repositories/requests.repository';
import { TimeOffController } from './time-off.controller';

/**
 * HcmOutboxWorker lives under src/hcm/ for code-organisation — it is
 * an HCM-integration concern alongside HcmClient and the mock. It is
 * registered here in TimeOffModule (not HcmModule) to avoid a
 * circular import: the worker depends on HcmOutboxRepository and
 * RequestsRepository (both time-off) and on HcmClient (which
 * TimeOffModule already imports via HcmModule).
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
    HcmOutboxRepository,
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
