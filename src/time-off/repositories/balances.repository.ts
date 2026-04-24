import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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

  upsert(row: BalanceRow, executor: Db = this.db): void {
    executor
      .insert(balances)
      .values(row)
      .onConflictDoUpdate({
        target: [balances.employeeId, balances.locationId, balances.leaveType],
        set: { hcmBalance: row.hcmBalance, updatedAt: row.updatedAt },
      })
      .run();
  }
}
