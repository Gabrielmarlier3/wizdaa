import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { balances } from '../../database/schema';

export interface BalanceRow {
  employeeId: string;
  locationId: string;
  leaveType: string;
  hcmBalance: number;
  updatedAt: string;
}

export interface BalanceDimension {
  employeeId: string;
  locationId: string;
  leaveType: string;
}

export interface BalanceUpsert extends BalanceDimension {
  hcmBalance: number;
  updatedAt: string;
}

@Injectable()
export class BalancesRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  findByDimension(
    employeeId: string,
    locationId: string,
    leaveType: string,
    executor: Db = this.db,
  ): BalanceRow | undefined {
    const row = executor
      .select()
      .from(balances)
      .where(
        and(
          eq(balances.employeeId, employeeId),
          eq(balances.locationId, locationId),
          eq(balances.leaveType, leaveType),
        ),
      )
      .get();
    return row;
  }

  /**
   * Full-corpus batch replacement — insert-or-replace on the
   * composite PK `(employee_id, location_id, leave_type)`.
   * hcmBalance and updatedAt are overwritten on conflict; the
   * conflict target is the PK itself. Idempotent by construction:
   * replaying the same input yields the same end state.
   *
   * Empty `rows` is a no-op; callers that want full-corpus
   * replacement must pair this with {@link deleteNotInSet}.
   */
  upsertBatch(rows: BalanceUpsert[], executor: Db = this.db): void {
    if (rows.length === 0) return;
    executor
      .insert(balances)
      .values(rows)
      .onConflictDoUpdate({
        target: [balances.employeeId, balances.locationId, balances.leaveType],
        set: {
          hcmBalance: sql`excluded.hcm_balance`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .run();
  }

  /**
   * Deletes every `balances` row whose composite key is NOT in
   * `keep`. Implemented by reading the existing key-set,
   * diffing in app memory, and issuing a DELETE per stale row.
   * The in-memory diff sidesteps SQLite's lack of tuple-aware
   * NOT IN; at the scale of HCM's periodic full-corpus batches
   * (low thousands of dimensions) the extra round-trips are
   * immaterial.
   *
   * Keys are encoded as JSON-stringified tuples rather than a
   * delimited string so a business identifier that happens to
   * contain any character cannot collide with another tuple.
   *
   * An empty `keep` array deletes every row. Callers that mean
   * "don't delete anything" must check their input before calling.
   */
  deleteNotInSet(keep: BalanceDimension[], executor: Db = this.db): void {
    const keepSet = new Set(keep.map(encodeDimensionKey));
    const existing = executor
      .select({
        employeeId: balances.employeeId,
        locationId: balances.locationId,
        leaveType: balances.leaveType,
      })
      .from(balances)
      .all();
    for (const e of existing) {
      if (keepSet.has(encodeDimensionKey(e))) continue;
      executor
        .delete(balances)
        .where(
          and(
            eq(balances.employeeId, e.employeeId),
            eq(balances.locationId, e.locationId),
            eq(balances.leaveType, e.leaveType),
          ),
        )
        .run();
    }
  }
}

function encodeDimensionKey(d: BalanceDimension): string {
  return JSON.stringify([d.employeeId, d.locationId, d.leaveType]);
}
