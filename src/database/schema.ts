import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { requestStatusValues } from '../domain/request';

export type { RequestStatus } from '../domain/request';

export const hcmSyncStatusValues = [
  'not_required',
  'pending',
  'synced',
  'failed',
] as const;

export type HcmSyncStatus = (typeof hcmSyncStatusValues)[number];

export const hcmOutboxStatusValues = [
  'pending',
  'synced',
  'failed_retryable',
  'failed_permanent',
] as const;

export type HcmOutboxStatus = (typeof hcmOutboxStatusValues)[number];

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
  // Denormalised projection of the outbox push state so a GET on the
  // request does not join hcm_outbox every time (TRD §9 *Approval
  // commits locally; HCM push via outbox*). Updated in the same tx
  // that moves the outbox row.
  hcmSyncStatus: text('hcm_sync_status', { enum: hcmSyncStatusValues })
    .notNull()
    .default('not_required'),
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

/**
 * `approved_deductions` is the approved-not-yet-pushed ledger line
 * created atomically with the approval transition (§9 *"Approval
 * commits locally; HCM push via outbox"*, §9 new decision
 * *"Approved deductions as a separate ledger table"*). Kept separate
 * from `holds` because the two lines have different lifecycles and
 * different projection conditions — the approved-deductions sum
 * joins on `hcm_outbox.status IN ('pending', 'failed_retryable')` to
 * exclude rows HCM has already acknowledged. One deduction per
 * request (UNIQUE `request_id`).
 */
export const approvedDeductions = sqliteTable('approved_deductions', {
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

/**
 * `hcm_outbox` is the durable retry queue for HCM pushes (§9
 * *"Approval commits locally; HCM push via outbox"*). One row per
 * request for the request's lifetime (UNIQUE `request_id`) — the
 * secondary anti-dup fence if a concurrent-approval guard is ever
 * weakened. `idempotency_key` is the service-generated UUID that
 * HCM sees as `Idempotency-Key` per §9 *"Dual idempotency"* /
 * service-UUID scope; also UNIQUE because the same mutation intent
 * must never duplicate on the wire.
 *
 * `status` lifecycle: `pending` → `synced` (2xx) | `failed_retryable`
 * (5xx / timeout / bad shape) | `failed_permanent` (4xx). The
 * `(status, next_attempt_at)` index is cheap and readies a future
 * worker's polling query.
 */
export const hcmOutbox = sqliteTable(
  'hcm_outbox',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id')
      .notNull()
      .unique()
      .references(() => requests.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    payloadJson: text('payload_json').notNull(),
    status: text('status', { enum: hcmOutboxStatusValues }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at').notNull(),
    lastError: text('last_error'),
    hcmMutationId: text('hcm_mutation_id'),
    syncedAt: text('synced_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusNextAttemptIdx: index('hcm_outbox_status_next_attempt_idx').on(
      table.status,
      table.nextAttemptAt,
    ),
  }),
);
