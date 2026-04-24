import { randomUUID } from 'node:crypto';
import BetterSqlite3 from 'better-sqlite3';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { Db } from '../database/connection';
import {
  approvePendingRequest,
  InvalidTransitionError,
  TimeOffRequest,
} from '../domain/request';
import { hasSufficientBalance } from '../domain/balance';
import { HcmClient } from '../hcm/hcm.client';
import {
  InsufficientBalanceError,
  InvalidDimensionError,
} from './create-request.use-case';
import { ApprovedDeductionsRepository } from './repositories/approved-deductions.repository';
import { BalancesRepository } from './repositories/balances.repository';
import { HcmOutboxRepository } from './repositories/hcm-outbox.repository';
import { HoldsRepository } from './repositories/holds.repository';
import { RequestsRepository } from './repositories/requests.repository';

export class RequestNotFoundError extends Error {
  constructor(id: string) {
    super(`Request not found: ${id}`);
    this.name = 'RequestNotFoundError';
  }
}

export interface ApproveRequestCommand {
  requestId: string;
}

interface CommittedContext {
  approved: TimeOffRequest;
  outboxId: string;
  idempotencyKey: string;
  payload: {
    employeeId: string;
    locationId: string;
    leaveType: string;
    days: number;
    reason: string;
    clientMutationId: string;
  };
}

function isOutboxUniqueRequestIdViolation(err: unknown): boolean {
  return (
    err instanceof BetterSqlite3.SqliteError &&
    err.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    err.message.includes('hcm_outbox.request_id')
  );
}

@Injectable()
export class ApproveRequestUseCase {
  private readonly logger = new Logger(ApproveRequestUseCase.name);

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly requestsRepo: RequestsRepository,
    private readonly holdsRepo: HoldsRepository,
    private readonly balancesRepo: BalancesRepository,
    private readonly approvedDeductionsRepo: ApprovedDeductionsRepository,
    private readonly outboxRepo: HcmOutboxRepository,
    private readonly hcmClient: HcmClient,
  ) {}

  async execute(cmd: ApproveRequestCommand): Promise<TimeOffRequest> {
    const committed = this.commitApproval(cmd.requestId);

    const result = await this.hcmClient.postMutation({
      ...committed.payload,
      idempotencyKey: committed.idempotencyKey,
    });

    return this.resolveSyncStatus(committed, result);
  }

  /**
   * Phase 1 (TRD §9 *Approval commits locally; HCM push via outbox*).
   * Every read and write inside the same db.transaction so the
   * balance check is stable against concurrent writers and the
   * ledger swap (hold → approved deduction) plus the outbox row are
   * atomic with the status transition.
   */
  private commitApproval(requestId: string): CommittedContext {
    return this.db.transaction((tx): CommittedContext => {
      const existing = this.requestsRepo.findById(requestId, tx);
      if (!existing) {
        throw new RequestNotFoundError(requestId);
      }
      if (existing.status !== 'pending') {
        throw new InvalidTransitionError(existing.status, 'approved');
      }

      const balance = this.balancesRepo.findByDimension(
        existing.employeeId,
        existing.locationId,
        existing.leaveType,
        tx,
      );
      if (!balance) {
        throw new InvalidDimensionError(
          `No balance record for (${existing.employeeId}, ${existing.locationId}, ${existing.leaveType})`,
        );
      }

      const pendingDays =
        this.holdsRepo.sumActiveHoldDaysForDimensionExcludingRequest(
          existing.employeeId,
          existing.locationId,
          existing.leaveType,
          existing.id,
          tx,
        );
      const approvedNotYetPushedDays =
        this.approvedDeductionsRepo.sumNotYetPushedDaysForDimension(
          existing.employeeId,
          existing.locationId,
          existing.leaveType,
          tx,
        );

      if (
        !hasSufficientBalance(
          {
            hcmBalance: balance.hcmBalance,
            pendingDays,
            approvedNotYetPushedDays,
          },
          existing.days,
        )
      ) {
        throw new InsufficientBalanceError(
          `Insufficient balance at approval time for (${existing.employeeId}, ${existing.locationId}, ${existing.leaveType})`,
        );
      }

      // Primary concurrency fence: UPDATE ... WHERE status='pending'.
      // A concurrent approver who committed first leaves us with 0
      // rows changed; bail as if the request is already approved.
      const changes = this.requestsRepo.approve(existing.id, tx);
      if (changes !== 1) {
        throw new InvalidTransitionError('approved', 'approved');
      }

      this.holdsRepo.deleteByRequestId(existing.id, tx);
      this.approvedDeductionsRepo.insert(
        {
          id: randomUUID(),
          requestId: existing.id,
          employeeId: existing.employeeId,
          locationId: existing.locationId,
          leaveType: existing.leaveType,
          days: existing.days,
        },
        tx,
      );

      const outboxId = randomUUID();
      const idempotencyKey = randomUUID();
      const payload = {
        employeeId: existing.employeeId,
        locationId: existing.locationId,
        leaveType: existing.leaveType,
        // Negative because approval deducts from the HCM balance.
        days: -existing.days,
        reason: 'TIME_OFF_APPROVED',
        clientMutationId: outboxId,
      };

      try {
        this.outboxRepo.insert(
          {
            id: outboxId,
            requestId: existing.id,
            idempotencyKey,
            payloadJson: JSON.stringify(payload),
            nextAttemptAt: new Date().toISOString(),
          },
          tx,
        );
      } catch (err) {
        // Secondary fence (R7): the primary fence on requests.status
        // should have caught this, but UNIQUE(request_id) on the
        // outbox is the belt-and-suspenders. Same outcome for the
        // caller either way.
        if (isOutboxUniqueRequestIdViolation(err)) {
          throw new InvalidTransitionError('approved', 'approved');
        }
        throw err;
      }

      return {
        approved: approvePendingRequest(existing),
        outboxId,
        idempotencyKey,
        payload,
      };
    });
  }

  /**
   * Phase 2/3: the inline push happens outside the transaction
   * (local commit is durable regardless of HCM availability), and
   * the response is folded back into a short second transaction so
   * the outbox row and requests.hcm_sync_status stay coherent.
   */
  private resolveSyncStatus(
    committed: CommittedContext,
    result: Awaited<ReturnType<HcmClient['postMutation']>>,
  ): TimeOffRequest {
    return this.db.transaction((tx): TimeOffRequest => {
      switch (result.kind) {
        case 'ok':
          this.outboxRepo.markSynced(
            committed.outboxId,
            result.hcmMutationId,
            new Date().toISOString(),
            tx,
          );
          this.requestsRepo.updateHcmSyncStatus(
            committed.approved.id,
            'synced',
            tx,
          );
          return { ...committed.approved, hcmSyncStatus: 'synced' };
        case 'permanent':
          this.logger.error(
            `HCM rejected mutation permanently for request ${committed.approved.id}: ${JSON.stringify(result.body)}`,
          );
          this.outboxRepo.markFailedPermanent(
            committed.outboxId,
            `status=${result.status} body=${JSON.stringify(result.body)}`,
            tx,
          );
          this.requestsRepo.updateHcmSyncStatus(
            committed.approved.id,
            'failed',
            tx,
          );
          return { ...committed.approved, hcmSyncStatus: 'failed' };
        case 'transient':
          this.logger.warn(
            `HCM push for request ${committed.approved.id} failed transiently: ${result.reason}`,
          );
          this.outboxRepo.markFailedRetryable(
            committed.outboxId,
            result.reason,
            this.nextAttemptAt(),
            tx,
          );
          // requests.hcm_sync_status stays 'pending' — a future
          // worker will retry with the same idempotencyKey.
          return committed.approved;
      }
    });
  }

  private nextAttemptAt(): string {
    // Minimal constant backoff for this slice; a future slice that
    // adds the out-of-process worker may grow this into a schedule.
    return new Date(Date.now() + 30_000).toISOString();
  }
}
