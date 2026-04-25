import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, ne, notInArray, sql } from 'drizzle-orm';
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

  /**
   * Symmetric terminal guard: a `synced` write must not overwrite
   * a `failed_permanent` row that a concurrent writer landed
   * first. The opposite direction (failed_permanent → synced) is
   * the more dangerous one — it would mask a 4xx HCM rejection
   * and re-issue a mutation HCM already refused — but the
   * invariant is the same shape as the guards on the failed_*
   * mark methods below, so `markSynced` carries the parallel
   * `WHERE status != 'failed_permanent'` clause too.
   */
  markSynced(
    id: string,
    hcmMutationId: string,
    syncedAt: string,
    executor: Db = this.db,
  ): void {
    executor
      .update(hcmOutbox)
      .set({ status: 'synced', hcmMutationId, syncedAt })
      .where(
        and(eq(hcmOutbox.id, id), ne(hcmOutbox.status, 'failed_permanent')),
      )
      .run();
  }

  /**
   * Both terminal states — `synced` and `failed_permanent` — are
   * protected against being overwritten by a late second writer.
   * Scenario: a slow inline push from the approve use case and a
   * worker tick both resolve the same row concurrently; better-
   * sqlite3 serialises the two transactions but the loser's write
   * must not walk the winner's terminal outcome backward to a
   * retryable or permanent state. Guarding both terminals keeps
   * the invariant symmetric so future slices (removed inline push,
   * second worker) do not introduce a regression (plan 009
   * Appendix A R5 plus reviewer pass).
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
      .where(
        and(
          eq(hcmOutbox.id, id),
          notInArray(hcmOutbox.status, ['synced', 'failed_permanent']),
        ),
      )
      .run();
  }

  /** Same terminal-state guards as {@link markFailedRetryable}. */
  markFailedPermanent(
    id: string,
    lastError: string,
    executor: Db = this.db,
  ): void {
    executor
      .update(hcmOutbox)
      .set({ status: 'failed_permanent', lastError })
      .where(
        and(
          eq(hcmOutbox.id, id),
          notInArray(hcmOutbox.status, ['synced', 'failed_permanent']),
        ),
      )
      .run();
  }
}
