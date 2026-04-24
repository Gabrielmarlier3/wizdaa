import {
  createPendingRequest,
  CreateRequestInput,
  InvalidRequestError,
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

  it('starts in pending status', () => {
    expect(createPendingRequest(base).status).toBe('pending');
  });

  it('maps the input `now` to the entity `createdAt` and preserves the rest', () => {
    const { now, ...rest } = base;
    expect(createPendingRequest(base)).toEqual({
      ...rest,
      status: 'pending',
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
