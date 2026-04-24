export const requestStatusValues = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;

export type RequestStatus = (typeof requestStatusValues)[number];

export const hcmSyncStatusValues = [
  'not_required',
  'pending',
  'synced',
  'failed',
] as const;

export type HcmSyncStatus = (typeof hcmSyncStatusValues)[number];

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: RequestStatus;
  hcmSyncStatus: HcmSyncStatus;
  clientRequestId: string;
  createdAt: string;
}

export interface CreateRequestInput {
  id: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  clientRequestId: string;
  now: string;
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: RequestStatus,
    public readonly to: RequestStatus,
  ) {
    super(`Cannot transition request from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function createPendingRequest(
  input: CreateRequestInput,
): TimeOffRequest {
  if (input.days <= 0) {
    throw new InvalidRequestError('days must be positive');
  }
  if (input.startDate > input.endDate) {
    throw new InvalidRequestError('startDate must be on or before endDate');
  }
  return {
    id: input.id,
    employeeId: input.employeeId,
    locationId: input.locationId,
    leaveType: input.leaveType,
    startDate: input.startDate,
    endDate: input.endDate,
    days: input.days,
    status: 'pending',
    hcmSyncStatus: 'not_required',
    clientRequestId: input.clientRequestId,
    createdAt: input.now,
  };
}

/**
 * Approval transition (TRD §9 *Approval commits locally; HCM push via
 * outbox*). Pure — the persistence write and the outbox row land in
 * the surrounding transaction. `hcmSyncStatus` moves to `pending`
 * here; the post-commit push attempt resolves it to `synced` or
 * `failed`.
 */
export function approvePendingRequest(request: TimeOffRequest): TimeOffRequest {
  if (request.status !== 'pending') {
    throw new InvalidTransitionError(request.status, 'approved');
  }
  return {
    ...request,
    status: 'approved',
    hcmSyncStatus: 'pending',
  };
}

/**
 * Rejection transition. Manager-initiated; terminal. Pure — the
 * persistence write and the hold release happen in the surrounding
 * transaction. `hcmSyncStatus` stays `not_required`: a rejected
 * request was never told to HCM and will not be (TRD §3.6 authority
 * boundaries). Reject is distinct from cancel (§9 *Cancellation is a
 * distinct terminal state from rejection*).
 */
export function rejectPendingRequest(request: TimeOffRequest): TimeOffRequest {
  if (request.status !== 'pending') {
    throw new InvalidTransitionError(request.status, 'rejected');
  }
  return {
    ...request,
    status: 'rejected',
  };
}

/**
 * Cancellation transition. Employee-initiated; terminal. Structurally
 * mirrors rejectPendingRequest — same flow (release hold in the
 * surrounding transaction), same non-touch of `hcmSyncStatus`
 * (a pending request was never pushed to HCM). Distinct from reject
 * at the audit level per TRD §9 *Cancellation is a distinct terminal
 * state from rejection*.
 */
export function cancelPendingRequest(request: TimeOffRequest): TimeOffRequest {
  if (request.status !== 'pending') {
    throw new InvalidTransitionError(request.status, 'cancelled');
  }
  return {
    ...request,
    status: 'cancelled',
  };
}
