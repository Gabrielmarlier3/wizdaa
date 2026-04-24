import {
  availableBalance,
  BalanceProjectionInput,
  hasSufficientBalance,
} from './balance';

describe('availableBalance', () => {
  it('returns hcm − pending − approvedNotYetPushed', () => {
    expect(
      availableBalance({
        hcmBalance: 10,
        pendingDays: 3,
        approvedNotYetPushedDays: 2,
      }),
    ).toBe(5);
  });

  it('is the HCM value when there are no local overlays', () => {
    expect(
      availableBalance({
        hcmBalance: 10,
        pendingDays: 0,
        approvedNotYetPushedDays: 0,
      }),
    ).toBe(10);
  });

  it('can be negative when local overlays exceed the HCM value', () => {
    expect(
      availableBalance({
        hcmBalance: 2,
        pendingDays: 3,
        approvedNotYetPushedDays: 0,
      }),
    ).toBe(-1);
  });
});

describe('hasSufficientBalance', () => {
  const base: BalanceProjectionInput = {
    hcmBalance: 10,
    pendingDays: 3,
    approvedNotYetPushedDays: 2,
  };

  it('is true when available > requested', () => {
    expect(hasSufficientBalance(base, 4)).toBe(true);
  });

  it('is true at the exact boundary (available == requested)', () => {
    expect(hasSufficientBalance(base, 5)).toBe(true);
  });

  it('is false when requested exceeds available by one', () => {
    expect(hasSufficientBalance(base, 6)).toBe(false);
  });

  it('is false when requested greatly exceeds available', () => {
    expect(hasSufficientBalance(base, 100)).toBe(false);
  });
});
