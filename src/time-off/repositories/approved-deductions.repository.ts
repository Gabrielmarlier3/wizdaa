import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { approvedDeductions, hcmOutbox } from '../../database/schema';

export interface ApprovedDeductionInsert {
  id: string;
  requestId: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  days: number;
}

/**
 * Second ledger-line type for the balance projection (TRD §3.4).
 * Joins `hcm_outbox` so the sum only counts rows whose HCM push
 * has not yet succeeded — per the §9 decision on approved_deductions
 * as a separate ledger table.
 */
@Injectable()
export class ApprovedDeductionsRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  insert(row: ApprovedDeductionInsert, executor: Db = this.db): void {
    executor.insert(approvedDeductions).values(row).run();
  }

  sumNotYetPushedDaysForDimension(
    employeeId: string,
    locationId: string,
    leaveType: string,
    executor: Db = this.db,
  ): number {
    const row = executor
      .select({
        total: sql<number>`COALESCE(SUM(${approvedDeductions.days}), 0)`,
      })
      .from(approvedDeductions)
      .innerJoin(
        hcmOutbox,
        eq(hcmOutbox.requestId, approvedDeductions.requestId),
      )
      .where(
        and(
          eq(approvedDeductions.employeeId, employeeId),
          eq(approvedDeductions.locationId, locationId),
          eq(approvedDeductions.leaveType, leaveType),
          inArray(hcmOutbox.status, ['pending', 'failed_retryable']),
        ),
      )
      .get();
    return row?.total ?? 0;
  }
}
