import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { inconsistencies } from '../../database/schema';

export interface InconsistencyRow {
  employeeId: string;
  locationId: string;
  leaveType: string;
  detectedAt: string;
  updatedAt: string;
}

export interface InconsistencyDimension {
  employeeId: string;
  locationId: string;
  leaveType: string;
}

/**
 * Current-state flag store for dimensions halted by the HCM batch
 * intake's §3.5 conflict predicate. Row presence blocks approval;
 * row absence allows it. Auto-clear is implemented by the use
 * case calling {@link deleteByDimension} whenever the predicate
 * does not fire for a dimension present in the incoming batch
 * (TRD §9 decision 14).
 */
@Injectable()
export class InconsistenciesRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  findByDimension(
    employeeId: string,
    locationId: string,
    leaveType: string,
    executor: Db = this.db,
  ): InconsistencyRow | undefined {
    return executor
      .select()
      .from(inconsistencies)
      .where(
        and(
          eq(inconsistencies.employeeId, employeeId),
          eq(inconsistencies.locationId, locationId),
          eq(inconsistencies.leaveType, leaveType),
        ),
      )
      .get();
  }

  /**
   * First detection: both `detected_at` and `updated_at` set to
   * the same `nowIso`. Re-flag of an already-present row: only
   * `updated_at` advances; `detected_at` preserves the original
   * detection moment so operators can see how long a dimension
   * has been halted.
   */
  upsert(
    employeeId: string,
    locationId: string,
    leaveType: string,
    nowIso: string,
    executor: Db = this.db,
  ): void {
    executor
      .insert(inconsistencies)
      .values({
        employeeId,
        locationId,
        leaveType,
        detectedAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: [
          inconsistencies.employeeId,
          inconsistencies.locationId,
          inconsistencies.leaveType,
        ],
        set: { updatedAt: nowIso },
      })
      .run();
  }

  /** No-op when the row is absent (UPDATE/DELETE returning zero changes). */
  deleteByDimension(
    employeeId: string,
    locationId: string,
    leaveType: string,
    executor: Db = this.db,
  ): void {
    executor
      .delete(inconsistencies)
      .where(
        and(
          eq(inconsistencies.employeeId, employeeId),
          eq(inconsistencies.locationId, locationId),
          eq(inconsistencies.leaveType, leaveType),
        ),
      )
      .run();
  }

  /**
   * Parallels {@link BalancesRepository.deleteNotInSet}: drops
   * every inconsistency row whose composite key is NOT in `keep`.
   * Used by the batch intake use case to clean up ghost flags
   * when HCM drops a dimension entirely from the corpus. Keys
   * are JSON-encoded to be collision-safe across any field
   * values.
   */
  deleteNotInSet(
    keep: InconsistencyDimension[],
    executor: Db = this.db,
  ): void {
    const keepSet = new Set(keep.map(encodeDimensionKey));
    const existing = executor
      .select({
        employeeId: inconsistencies.employeeId,
        locationId: inconsistencies.locationId,
        leaveType: inconsistencies.leaveType,
      })
      .from(inconsistencies)
      .all();
    for (const row of existing) {
      if (keepSet.has(encodeDimensionKey(row))) continue;
      executor
        .delete(inconsistencies)
        .where(
          and(
            eq(inconsistencies.employeeId, row.employeeId),
            eq(inconsistencies.locationId, row.locationId),
            eq(inconsistencies.leaveType, row.leaveType),
          ),
        )
        .run();
    }
  }
}

function encodeDimensionKey(d: InconsistencyDimension): string {
  return JSON.stringify([d.employeeId, d.locationId, d.leaveType]);
}
