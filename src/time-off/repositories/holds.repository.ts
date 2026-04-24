import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { holds } from '../../database/schema';

export interface HoldInsert {
  id: string;
  requestId: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  days: number;
}

@Injectable()
export class HoldsRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  insert(hold: HoldInsert, executor: Db = this.db): void {
    executor
      .insert(holds)
      .values({
        id: hold.id,
        requestId: hold.requestId,
        employeeId: hold.employeeId,
        locationId: hold.locationId,
        leaveType: hold.leaveType,
        days: hold.days,
      })
      .run();
  }

  sumActiveHoldDaysForDimension(
    employeeId: string,
    locationId: string,
    leaveType: string,
    executor: Db = this.db,
  ): number {
    const row = executor
      .select({ total: sql<number>`COALESCE(SUM(${holds.days}), 0)` })
      .from(holds)
      .where(
        and(
          eq(holds.employeeId, employeeId),
          eq(holds.locationId, locationId),
          eq(holds.leaveType, leaveType),
        ),
      )
      .get();
    return row?.total ?? 0;
  }

  /**
   * Pending-day projection excluding the hold owned by the request
   * currently being approved. Without the exclusion, the approve
   * use case's balance re-check would double-count the requested
   * days (see plan 005 Appendix A §2 step 3).
   */
  sumActiveHoldDaysForDimensionExcludingRequest(
    employeeId: string,
    locationId: string,
    leaveType: string,
    excludeRequestId: string,
    executor: Db = this.db,
  ): number {
    const row = executor
      .select({ total: sql<number>`COALESCE(SUM(${holds.days}), 0)` })
      .from(holds)
      .where(
        and(
          eq(holds.employeeId, employeeId),
          eq(holds.locationId, locationId),
          eq(holds.leaveType, leaveType),
          ne(holds.requestId, excludeRequestId),
        ),
      )
      .get();
    return row?.total ?? 0;
  }

  deleteByRequestId(requestId: string, executor: Db = this.db): void {
    executor.delete(holds).where(eq(holds.requestId, requestId)).run();
  }
}
