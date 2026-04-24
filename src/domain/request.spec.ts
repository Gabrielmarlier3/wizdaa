import {
  approvePendingRequest,
  createPendingRequest,
  CreateRequestInput,
  InvalidRequestError,
  InvalidTransitionError,
  rejectPendingRequest,
  TimeOffRequest,
} from './request';

describe('createPendingRequest', () => {
  const base: CreateRequestInput = {
    id: 'req-1',
    employeeId: 'emp-1',
    locationId: 'loc-1',
    leaveType: 'PTO',
    startDate: '2026-05-01',
    endDate: '2026-05-02',
    days: 2,
    clientRequestId: 'client-1',
    now: '2026-04-24T12:00:00Z',
  };

  it('starts in pending status with hcmSyncStatus = not_required', () => {
    const req = createPendingRequest(base);
    expect(req.status).toBe('pending');
    expect(req.hcmSyncStatus).toBe('not_required');
  });

  it('maps the input `now` to the entity `createdAt` and preserves the rest', () => {
    const { now, ...rest } = base;
    expect(createPendingRequest(base)).toEqual({
      ...rest,
      status: 'pending',
      hcmSyncStatus: 'not_required',
      createdAt: now,
    });
  });

  it('rejects zero days', () => {
    expect(() => createPendingRequest({ ...base, days: 0 })).toThrow(
      InvalidRequestError,
    );
  });

  it('rejects negative days', () => {
    expect(() => createPendingRequest({ ...base, days: -1 })).toThrow(
      InvalidRequestError,
    );
  });

  it('accepts a single-day request (startDate == endDate)', () => {
    expect(() =>
      createPendingRequest({
        ...base,
        startDate: '2026-05-01',
        endDate: '2026-05-01',
        days: 1,
      }),
    ).not.toThrow();
  });

  it('rejects startDate after endDate', () => {
    expect(() =>
      createPendingRequest({
        ...base,
        startDate: '2026-05-05',
        endDate: '2026-05-01',
      }),
    ).toThrow(InvalidRequestError);
  });
});

describe('approvePendingRequest', () => {
  const pending: TimeOffRequest = createPendingRequest({
    id: 'req-2',
    employeeId: 'emp-1',
    locationId: 'loc-1',
    leaveType: 'PTO',
    startDate: '2026-05-01',
    endDate: '2026-05-02',
    days: 2,
    clientRequestId: 'client-2',
    now: '2026-04-24T12:00:00Z',
  });

  it('transitions status pending → approved and hcmSyncStatus → pending', () => {
    const approved = approvePendingRequest(pending);
    expect(approved.status).toBe('approved');
    expect(approved.hcmSyncStatus).toBe('pending');
  });

  it('preserves all other fields of the original request', () => {
    const approved = approvePendingRequest(pending);
    expect(approved).toEqual({
      ...pending,
      status: 'approved',
      hcmSyncStatus: 'pending',
    });
  });

  it('throws InvalidTransitionError when the request is already approved', () => {
    const alreadyApproved: TimeOffRequest = {
      ...pending,
      status: 'approved',
      hcmSyncStatus: 'pending',
    };
    expect(() => approvePendingRequest(alreadyApproved)).toThrow(
      InvalidTransitionError,
    );
  });

  it('throws InvalidTransitionError when the request is rejected', () => {
    const rejected: TimeOffRequest = { ...pending, status: 'rejected' };
    expect(() => approvePendingRequest(rejected)).toThrow(
      InvalidTransitionError,
    );
  });

  it('throws InvalidTransitionError when the request is cancelled', () => {
    const cancelled: TimeOffRequest = { ...pending, status: 'cancelled' };
    expect(() => approvePendingRequest(cancelled)).toThrow(
      InvalidTransitionError,
    );
  });

  it('carries the from/to statuses on the thrown error', () => {
    const approved: TimeOffRequest = {
      ...pending,
      status: 'approved',
      hcmSyncStatus: 'pending',
    };
    try {
      approvePendingRequest(approved);
      fail('expected InvalidTransitionError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const ite = err as InvalidTransitionError;
      expect(ite.from).toBe('approved');
      expect(ite.to).toBe('approved');
    }
  });
});

describe('rejectPendingRequest', () => {
  const pending: TimeOffRequest = createPendingRequest({
    id: 'req-3',
    employeeId: 'emp-1',
    locationId: 'loc-1',
    leaveType: 'PTO',
    startDate: '2026-05-01',
    endDate: '2026-05-02',
    days: 2,
    clientRequestId: 'client-3',
    now: '2026-04-24T12:00:00Z',
  });

  it('transitions status pending → rejected and leaves hcmSyncStatus at not_required', () => {
    const rejected = rejectPendingRequest(pending);
    expect(rejected.status).toBe('rejected');
    expect(rejected.hcmSyncStatus).toBe('not_required');
  });

  it('preserves all other fields of the original request', () => {
    const rejected = rejectPendingRequest(pending);
    expect(rejected).toEqual({
      ...pending,
      status: 'rejected',
    });
  });

  it('throws InvalidTransitionError when the request is already approved', () => {
    const approved: TimeOffRequest = {
      ...pending,
      status: 'approved',
      hcmSyncStatus: 'pending',
    };
    expect(() => rejectPendingRequest(approved)).toThrow(
      InvalidTransitionError,
    );
  });

  it('throws InvalidTransitionError when the request is already rejected', () => {
    const alreadyRejected: TimeOffRequest = { ...pending, status: 'rejected' };
    expect(() => rejectPendingRequest(alreadyRejected)).toThrow(
      InvalidTransitionError,
    );
  });

  it('throws InvalidTransitionError when the request is cancelled', () => {
    const cancelled: TimeOffRequest = { ...pending, status: 'cancelled' };
    expect(() => rejectPendingRequest(cancelled)).toThrow(
      InvalidTransitionError,
    );
  });

  it('carries the from/to statuses on the thrown error', () => {
    const approved: TimeOffRequest = {
      ...pending,
      status: 'approved',
      hcmSyncStatus: 'pending',
    };
    try {
      rejectPendingRequest(approved);
      fail('expected InvalidTransitionError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const ite = err as InvalidTransitionError;
      expect(ite.from).toBe('approved');
      expect(ite.to).toBe('rejected');
    }
  });
});
