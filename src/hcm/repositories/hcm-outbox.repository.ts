import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { hcmOutbox, HcmOutboxStatus } from '../../database/schema';

export interface HcmOutboxInsert {
  id: string;
  requestId: string;
  idempotencyKey: string;
  payloadJson: string;
  nextAttemptAt: string;
}

/**
 * Row shape returned to the outbox worker. Narrower than the raw
 * table row — the worker only needs the fields required to drive a
 * retry (idempotencyKey, payloadJson) plus the bookkeeping fields
 * that decide the next transition (status, attempts, nextAttemptAt).
 */
export interface HcmOutboxDueRow {
  id: string;
  requestId: string;
  idempotencyKey: string;
  payloadJson: string;
  status: HcmOutboxStatus;
  attempts: number;
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

  /**
   * Returns up to `limit` rows that the outbox worker should attempt
   * next: `pending` or `failed_retryable`, with `next_attempt_at`
   * already in the past. Ordered by `next_attempt_at ASC` so older
   * rows never starve. The single-process worker invariant makes
   * row locking unnecessary.
   */
  claimDueBatch(
    limit: number,
    nowIso: string,
    executor: Db = this.db,
  ): HcmOutboxDueRow[] {
    return executor
      .select({
        id: hcmOutbox.id,
        requestId: hcmOutbox.requestId,
        idempotencyKey: hcmOutbox.idempotencyKey,
        payloadJson: hcmOutbox.payloadJson,
        status: hcmOutbox.status,
        attempts: hcmOutbox.attempts,
        nextAttemptAt: hcmOutbox.nextAttemptAt,
      })
      .from(hcmOutbox)
      .where(
        and(
          inArray(hcmOutbox.status, ['pending', 'failed_retryable']),
          lte(hcmOutbox.nextAttemptAt, nowIso),
        ),
      )
      .orderBy(asc(hcmOutbox.nextAttemptAt))
      .limit(limit)
      .all();
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

  /**
   * Guarded against downgrading a `synced` row: if a slow inline
   * push from the approve use case completes at roughly the same
   * time a worker tick is resolving the same row, both may try to
   * write. `synced` is terminal — the guard keeps the terminal
   * value in place even if the second writer reached a transient
   * outcome on a retry (plan 009 Appendix A R5).
   */
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
      .where(and(eq(hcmOutbox.id, id), ne(hcmOutbox.status, 'synced')))
      .run();
  }

  /** Same terminal-state guard as {@link markFailedRetryable}. */
  markFailedPermanent(
    id: string,
    lastError: string,
    executor: Db = this.db,
  ): void {
    executor
      .update(hcmOutbox)
      .set({ status: 'failed_permanent', lastError })
      .where(and(eq(hcmOutbox.id, id), ne(hcmOutbox.status, 'synced')))
      .run();
  }
}
