import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { requests } from '../../database/schema';
import { RequestStatus, TimeOffRequest } from '../../domain/request';

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
      clientRequestId: row.clientRequestId,
      createdAt: row.createdAt,
    };
  }
}
