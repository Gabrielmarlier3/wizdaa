import { TimeOffRequest } from '../domain/request';
import { RequestNotFoundError } from './errors';
import { GetRequestUseCase } from './get-request.use-case';
import { RequestsRepository } from './repositories/requests.repository';

describe('GetRequestUseCase', () => {
  function build(row: TimeOffRequest | undefined): {
    useCase: GetRequestUseCase;
    findByIdMock: jest.Mock;
  } {
    const findByIdMock = jest.fn().mockReturnValue(row);
    const repo = { findById: findByIdMock } as unknown as RequestsRepository;
    return {
      useCase: new GetRequestUseCase(repo),
      findByIdMock,
    };
  }

  const sample: TimeOffRequest = {
    id: 'req-1',
    employeeId: 'emp-1',
    locationId: 'loc-1',
    leaveType: 'PTO',
    startDate: '2026-05-01',
    endDate: '2026-05-02',
    days: 2,
    status: 'pending',
    hcmSyncStatus: 'not_required',
    clientRequestId: 'client-1',
    createdAt: '2026-04-24T12:00:00Z',
  };

  it('returns the entity when the repository finds it', () => {
    const { useCase, findByIdMock } = build(sample);

    const result = useCase.execute({ requestId: 'req-1' });

    expect(result).toEqual(sample);
    expect(findByIdMock).toHaveBeenCalledWith('req-1');
  });

  it('throws RequestNotFoundError when the repository returns undefined', () => {
    const { useCase } = build(undefined);

    expect(() => useCase.execute({ requestId: 'req-missing' })).toThrow(
      RequestNotFoundError,
    );
  });

  it('carries the requested id in the thrown error message', () => {
    const { useCase } = build(undefined);

    try {
      useCase.execute({ requestId: 'req-missing' });
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RequestNotFoundError);
      expect((err as Error).message).toContain('req-missing');
    }
  });
});
