export const requestStatusValues = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;

export type RequestStatus = (typeof requestStatusValues)[number];

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: RequestStatus;
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
    clientRequestId: input.clientRequestId,
    createdAt: input.now,
  };
}
