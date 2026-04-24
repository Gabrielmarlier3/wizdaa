import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { Db } from '../database/connection';
import {
  cancelPendingRequest,
  InvalidTransitionError,
  TimeOffRequest,
} from '../domain/request';
import { RequestNotFoundError } from './errors';
import { HoldsRepository } from './repositories/holds.repository';
import { RequestsRepository } from './repositories/requests.repository';

export interface CancelRequestCommand {
  requestId: string;
}

/**
 * Employee-initiated cancellation of a pending request (TRD §9
 * *Cancellation is a distinct terminal state from rejection*).
 *
 * Single transaction, no HCM interaction — structurally identical
 * to RejectRequestUseCase with 'rejected' replaced by 'cancelled'.
 * The two use cases stay as separate files deliberately: DRY
 * extraction waits for a third terminal-transition shape or a
 * reviewer signal (plan 007 decision 3, §10 no speculative
 * abstraction).
 */
@Injectable()
export class CancelRequestUseCase {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly requestsRepo: RequestsRepository,
    private readonly holdsRepo: HoldsRepository,
  ) {}

  execute(cmd: CancelRequestCommand): TimeOffRequest {
    return this.db.transaction((tx): TimeOffRequest => {
      const existing = this.requestsRepo.findById(cmd.requestId, tx);
      if (!existing) {
        throw new RequestNotFoundError(cmd.requestId);
      }
      if (existing.status !== 'pending') {
        throw new InvalidTransitionError(existing.status, 'cancelled');
      }

      const changes = this.requestsRepo.cancel(existing.id, tx);
      if (changes !== 1) {
        const current = this.requestsRepo.findById(existing.id, tx);
        if (!current) {
          throw new RequestNotFoundError(existing.id);
        }
        throw new InvalidTransitionError(current.status, 'cancelled');
      }

      this.holdsRepo.deleteByRequestId(existing.id, tx);

      return cancelPendingRequest(existing);
    });
  }
}
