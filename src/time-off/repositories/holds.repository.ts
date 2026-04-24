import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
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
}
