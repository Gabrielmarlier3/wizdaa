import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { requests } from '../../database/schema';
import {
  HcmSyncStatus,
  RequestStatus,
  TimeOffRequest,
} from '../../domain/request';

type RequestRow = typeof requests.$inferSelect;

@Injectable()
export class RequestsRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  findByClientRequestId(
    clientRequestId: string,
    executor: Db = this.db,
  ): TimeOffRequest | undefined {
    const row = executor
      .select()
      .from(requests)
      .where(eq(requests.clientRequestId, clientRequestId))
      .get();
    return row ? this.toDomain(row) : undefined;
  }

  findById(id: string, executor: Db = this.db): TimeOffRequest | undefined {
    const row = executor
      .select()
      .from(requests)
      .where(eq(requests.id, id))
      .get();
    return row ? this.toDomain(row) : undefined;
  }

  /**
   * Guarded state transition pending → approved. Returns the number
   * of rows changed (0 or 1). A second concurrent approver sees 0
   * and the caller raises InvalidTransitionError — this is the
   * primary concurrency fence per plan 005 Appendix A §4 R1.
   */
  approve(id: string, executor: Db = this.db): number {
    const result = executor
      .update(requests)
      .set({ status: 'approved', hcmSyncStatus: 'pending' })
      .where(and(eq(requests.id, id), eq(requests.status, 'pending')))
      .run();
    return Number(result.changes);
  }

  updateHcmSyncStatus(
    id: string,
    hcmSyncStatus: HcmSyncStatus,
    executor: Db = this.db,
  ): void {
    executor
      .update(requests)
      .set({ hcmSyncStatus })
      .where(eq(requests.id, id))
      .run();
  }

  insert(request: TimeOffRequest, executor: Db = this.db): void {
    executor
      .insert(requests)
      .values({
        id: request.id,
        employeeId: request.employeeId,
        locationId: request.locationId,
        leaveType: request.leaveType,
        startDate: request.startDate,
        endDate: request.endDate,
        days: request.days,
        status: request.status,
        hcmSyncStatus: request.hcmSyncStatus,
        clientRequestId: request.clientRequestId,
        createdAt: request.createdAt,
      })
      .run();
  }

  private toDomain(row: RequestRow): TimeOffRequest {
    return {
      id: row.id,
      employeeId: row.employeeId,
      locationId: row.locationId,
      leaveType: row.leaveType,
      startDate: row.startDate,
      endDate: row.endDate,
      days: row.days,
      status: row.status as RequestStatus,
      hcmSyncStatus: row.hcmSyncStatus as HcmSyncStatus,
      clientRequestId: row.clientRequestId,
      createdAt: row.createdAt,
    };
  }
}
