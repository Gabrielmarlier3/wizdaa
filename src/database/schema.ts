import { sql } from 'drizzle-orm';
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

/**
 * `balances` mirrors the authoritative HCM value per dimension
 * (TRD §3.4). Local overlays — pending holds, approved-not-yet-pushed
 * deductions — are kept in their own tables so the effective
 * available balance is a derived projection, not a destructive update.
 *
 * Composite primary key = the balance grain stated in §9
 * *"Balance dimension includes leaveType"*.
 */
export const balances = sqliteTable(
  'balances',
  {
    employeeId: text('employee_id').notNull(),
    locationId: text('location_id').notNull(),
    leaveType: text('leave_type').notNull(),
    hcmBalance: integer('hcm_balance').notNull(),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.employeeId, table.locationId, table.leaveType],
    }),
  }),
);

export const requestStatusValues = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;

export type RequestStatus = (typeof requestStatusValues)[number];

/**
 * `requests` is the lifecycle row for a time-off request. The
 * four-state DAG (§9 *"Cancellation is a distinct terminal state"*)
 * is encoded in `status` with an app-level enum; SQLite stores it as
 * text.
 *
 * `client_request_id` is UNIQUE to satisfy the idempotency decision
 * in §9 *"Dual idempotency: client UUID on request, service UUID on
 * outbox"*. A second POST with the same key returns the same entity.
 */
export const requests = sqliteTable('requests', {
  id: text('id').primaryKey(),
  employeeId: text('employee_id').notNull(),
  locationId: text('location_id').notNull(),
  leaveType: text('leave_type').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  days: integer('days').notNull(),
  status: text('status', { enum: requestStatusValues }).notNull(),
  clientRequestId: text('client_request_id').notNull().unique(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/**
 * `holds` is the pending-reservation ledger line created atomically
 * with a `pending` request (§9 *"Reserve balance at creation as
 * pending hold"*). One hold per request (UNIQUE `request_id`);
 * cascade delete is for tests only — in production, approve/reject/
 * cancel transitions update state rather than delete rows.
 */
export const holds = sqliteTable('holds', {
  id: text('id').primaryKey(),
  requestId: text('request_id')
    .notNull()
    .unique()
    .references(() => requests.id, { onDelete: 'cascade' }),
  employeeId: text('employee_id').notNull(),
  locationId: text('location_id').notNull(),
  leaveType: text('leave_type').notNull(),
  days: integer('days').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
