import { ApprovedDeductionsRepository } from '../time-off/repositories/approved-deductions.repository';
import {
  BalanceRow,
  BalancesRepository,
} from '../time-off/repositories/balances.repository';
import { HoldsRepository } from '../time-off/repositories/holds.repository';
import { BalanceNotFoundError } from './errors';
import { GetBalanceUseCase } from './get-balance.use-case';

describe('GetBalanceUseCase', () => {
  function build(options: {
    balance: BalanceRow | undefined;
    pendingDays?: number;
    approvedNotYetPushedDays?: number;
  }): {
    useCase: GetBalanceUseCase;
    findByDimensionMock: jest.Mock;
    pendingSumMock: jest.Mock;
    approvedSumMock: jest.Mock;
  } {
    const findByDimensionMock = jest.fn().mockReturnValue(options.balance);
    const pendingSumMock = jest
      .fn()
      .mockReturnValue(options.pendingDays ?? 0);
    const approvedSumMock = jest
      .fn()
      .mockReturnValue(options.approvedNotYetPushedDays ?? 0);
    const balances = {
      findByDimension: findByDimensionMock,
    } as unknown as BalancesRepository;
    const holds = {
      sumActiveHoldDaysForDimension: pendingSumMock,
    } as unknown as HoldsRepository;
    const approvedDeductions = {
      sumNotYetPushedDaysForDimension: approvedSumMock,
    } as unknown as ApprovedDeductionsRepository;
    return {
      useCase: new GetBalanceUseCase(balances, holds, approvedDeductions),
      findByDimensionMock,
      pendingSumMock,
      approvedSumMock,
    };
  }

  const row: BalanceRow = {
    employeeId: 'emp-1',
    locationId: 'loc-1',
    leaveType: 'PTO',
    hcmBalance: 10,
    updatedAt: '2026-04-24T12:00:00Z',
  };

  it('returns the full breakdown with the correct arithmetic', () => {
    const { useCase } = build({
      balance: row,
      pendingDays: 3,
      approvedNotYetPushedDays: 2,
    });

    const result = useCase.execute({
      employeeId: 'emp-1',
      locationId: 'loc-1',
      leaveType: 'PTO',
    });

    expect(result).toEqual({
      employeeId: 'emp-1',
      locationId: 'loc-1',
      leaveType: 'PTO',
      hcmBalance: 10,
      pendingDays: 3,
      approvedNotYetPushedDays: 2,
      availableDays: 5,
    });
  });

  it('returns the raw HCM balance when no overlays apply', () => {
    const { useCase } = build({ balance: row });

    const result = useCase.execute({
      employeeId: 'emp-1',
      locationId: 'loc-1',
      leaveType: 'PTO',
    });

    expect(result.availableDays).toBe(10);
    expect(result.pendingDays).toBe(0);
    expect(result.approvedNotYetPushedDays).toBe(0);
  });

  it('throws BalanceNotFoundError when the dimension has no balance row', () => {
    const { useCase } = build({ balance: undefined });

    expect(() =>
      useCase.execute({
        employeeId: 'emp-missing',
        locationId: 'loc-BR',
        leaveType: 'PTO',
      }),
    ).toThrow(BalanceNotFoundError);
  });

  it('carries the queried dimension on the thrown error', () => {
    const { useCase } = build({ balance: undefined });

    try {
      useCase.execute({
        employeeId: 'emp-missing',
        locationId: 'loc-BR',
        leaveType: 'PTO',
      });
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BalanceNotFoundError);
      const e = err as BalanceNotFoundError;
      expect(e.employeeId).toBe('emp-missing');
      expect(e.locationId).toBe('loc-BR');
      expect(e.leaveType).toBe('PTO');
    }
  });

  it('passes the queried dimension through to every repository call', () => {
    const { useCase, findByDimensionMock, pendingSumMock, approvedSumMock } =
      build({ balance: row, pendingDays: 1, approvedNotYetPushedDays: 0 });

    useCase.execute({
      employeeId: 'emp-1',
      locationId: 'loc-1',
      leaveType: 'PTO',
    });

    expect(findByDimensionMock).toHaveBeenCalledWith(
      'emp-1',
      'loc-1',
      'PTO',
    );
    expect(pendingSumMock).toHaveBeenCalledWith('emp-1', 'loc-1', 'PTO');
    expect(approvedSumMock).toHaveBeenCalledWith('emp-1', 'loc-1', 'PTO');
  });
});
