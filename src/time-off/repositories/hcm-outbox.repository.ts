import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { hcmOutbox } from '../../database/schema';

export interface HcmOutboxInsert {
  id: string;
  requestId: string;
  idempotencyKey: string;
  payloadJson: string;
  nextAttemptAt: string;
}

/**
 * Durable retry queue for HCM pushes (TRD §9 *Approval commits
 * locally; HCM push via outbox*). One row per request for the
 * request's lifetime. Status transitions:
 * `pending` → `synced` (2xx) | `failed_retryable` (5xx/timeout/bad
 * shape) | `failed_permanent` (4xx).
 */
@Injectable()
export class HcmOutboxRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  insert(row: HcmOutboxInsert, executor: Db = this.db): void {
    executor
      .insert(hcmOutbox)
      .values({
        id: row.id,
        requestId: row.requestId,
        idempotencyKey: row.idempotencyKey,
        payloadJson: row.payloadJson,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: row.nextAttemptAt,
      })
      .run();
  }

  markSynced(
    id: string,
    hcmMutationId: string,
    syncedAt: string,
    executor: Db = this.db,
  ): void {
    executor
      .update(hcmOutbox)
      .set({ status: 'synced', hcmMutationId, syncedAt })
      .where(eq(hcmOutbox.id, id))
      .run();
  }

  markFailedRetryable(
    id: string,
    lastError: string,
    nextAttemptAt: string,
    executor: Db = this.db,
  ): void {
    executor
      .update(hcmOutbox)
      .set({
        status: 'failed_retryable',
        lastError,
        nextAttemptAt,
        attempts: sql`${hcmOutbox.attempts} + 1`,
      })
      .where(eq(hcmOutbox.id, id))
      .run();
  }

  markFailedPermanent(
    id: string,
    lastError: string,
    executor: Db = this.db,
  ): void {
    executor
      .update(hcmOutbox)
      .set({ status: 'failed_permanent', lastError })
      .where(eq(hcmOutbox.id, id))
      .run();
  }
}
