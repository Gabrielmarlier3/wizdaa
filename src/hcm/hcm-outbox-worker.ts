import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { Db } from '../database/connection';
import {
  HcmOutboxDueRow,
  HcmOutboxRepository,
} from '../time-off/repositories/hcm-outbox.repository';
import { RequestsRepository } from '../time-off/repositories/requests.repository';
import { HcmClient, HcmMutationResult } from './hcm.client';

export { HcmOutboxDueRow } from '../time-off/repositories/hcm-outbox.repository';

/**
 * After 5 attempts fail with transient outcomes, the row is promoted
 * to `failed_permanent` and `requests.hcmSyncStatus` flips to
 * `'failed'`. With exponential backoff (30s × 2^attempts, capped at
 * 30 min) the total window before permanent is ~15 minutes — long
 * enough to survive a transient HCM outage without leaving the
 * overlay projection degraded indefinitely.
 */
export const MAX_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_CAP_MS = 30 * 60_000;
export const BATCH_SIZE = 10;

interface StoredPayload {
  employeeId: string;
  locationId: string;
  leaveType: string;
  days: number;
  reason: string;
  clientMutationId: string;
}

@Injectable()
export class HcmOutboxWorker {
  private readonly logger = new Logger(HcmOutboxWorker.name);

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly outboxRepo: HcmOutboxRepository,
    private readonly requestsRepo: RequestsRepository,
    private readonly hcmClient: HcmClient,
  ) {}

  /**
   * One pass over the outbox: claim due rows, push each via the HCM
   * client, and resolve the outcome in a small transaction that
   * updates the outbox row and `requests.hcmSyncStatus` together.
   * Public so integration and e2e tests can drive it deterministically.
   */
  async tick(): Promise<void> {
    const now = new Date().toISOString();
    const rows = this.outboxRepo.claimDueBatch(BATCH_SIZE, now);
    if (rows.length === 0) {
      return;
    }
    this.logger.debug(`outbox worker tick: ${rows.length} due row(s)`);
    for (const row of rows) {
      await this.processRow(row);
    }
  }

  private async processRow(row: HcmOutboxDueRow): Promise<void> {
    const payload = JSON.parse(row.payloadJson) as StoredPayload;
    const result = await this.hcmClient.postMutation({
      employeeId: payload.employeeId,
      locationId: payload.locationId,
      leaveType: payload.leaveType,
      days: payload.days,
      reason: payload.reason,
      clientMutationId: payload.clientMutationId,
      idempotencyKey: row.idempotencyKey,
    });

    this.db.transaction((tx) => {
      this.resolve(row, result, tx);
    });
  }

  private resolve(
    row: HcmOutboxDueRow,
    result: HcmMutationResult,
    tx: Db,
  ): void {
    switch (result.kind) {
      case 'ok': {
        this.outboxRepo.markSynced(
          row.id,
          result.hcmMutationId,
          new Date().toISOString(),
          tx,
        );
        this.requestsRepo.updateHcmSyncStatus(row.requestId, 'synced', tx);
        this.logger.log(
          `outbox synced request ${row.requestId} via HCM mutation ${result.hcmMutationId}`,
        );
        return;
      }
      case 'permanent': {
        const error = `status=${result.status} body=${JSON.stringify(result.body)}`;
        this.outboxRepo.markFailedPermanent(row.id, error, tx);
        this.requestsRepo.updateHcmSyncStatus(row.requestId, 'failed', tx);
        this.logger.error(
          `outbox permanent failure for request ${row.requestId}: ${error}`,
        );
        return;
      }
      case 'transient': {
        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          const error = `exhausted after ${nextAttempts} attempts: ${result.reason}`;
          this.outboxRepo.markFailedPermanent(row.id, error, tx);
          this.requestsRepo.updateHcmSyncStatus(row.requestId, 'failed', tx);
          this.logger.error(
            `outbox permanent failure (exhausted) for request ${row.requestId}: ${error}`,
          );
          return;
        }
        const nextAt = this.nextAttemptAt(row.attempts);
        this.outboxRepo.markFailedRetryable(row.id, result.reason, nextAt, tx);
        this.logger.warn(
          `outbox transient failure for request ${row.requestId}, attempt ${nextAttempts}/${MAX_ATTEMPTS}, next at ${nextAt}: ${result.reason}`,
        );
        return;
      }
    }
  }

  private nextAttemptAt(attempts: number): string {
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS);
    return new Date(Date.now() + delay).toISOString();
  }
}
