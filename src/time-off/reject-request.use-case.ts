import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { Db } from '../database/connection';
import {
  InvalidTransitionError,
  rejectPendingRequest,
  TimeOffRequest,
} from '../domain/request';
import { RequestNotFoundError } from './approve-request.use-case';
import { HoldsRepository } from './repositories/holds.repository';
import { RequestsRepository } from './repositories/requests.repository';

export interface RejectRequestCommand {
  requestId: string;
}

/**
 * Manager-initiated rejection of a pending request (TRD §9
 * *Cancellation is a distinct terminal state from rejection*).
 *
 * Single transaction, no HCM interaction:
 *   1. Load the request; 404 if missing.
 *   2. Status guard; 409 INVALID_TRANSITION if not pending.
 *   3. Guarded UPDATE; re-read on 0 changes to report the honest
 *      currentStatus (mirrors the plan 005 C1 fix for approve).
 *   4. Release the pending hold atomically with the status change.
 *
 * No outbox row, no HCM push, no second transaction — the rejected
 * request was never told to HCM and never will be (§3.6).
 */
@Injectable()
export class RejectRequestUseCase {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly requestsRepo: RequestsRepository,
    private readonly holdsRepo: HoldsRepository,
  ) {}

  execute(cmd: RejectRequestCommand): TimeOffRequest {
    return this.db.transaction((tx): TimeOffRequest => {
      const existing = this.requestsRepo.findById(cmd.requestId, tx);
      if (!existing) {
        throw new RequestNotFoundError(cmd.requestId);
      }
      if (existing.status !== 'pending') {
        throw new InvalidTransitionError(existing.status, 'rejected');
      }

      const changes = this.requestsRepo.reject(existing.id, tx);
      if (changes !== 1) {
        const current = this.requestsRepo.findById(existing.id, tx);
        if (!current) {
          throw new RequestNotFoundError(existing.id);
        }
        throw new InvalidTransitionError(current.status, 'rejected');
      }

      this.holdsRepo.deleteByRequestId(existing.id, tx);

      return rejectPendingRequest(existing);
    });
  }
}
