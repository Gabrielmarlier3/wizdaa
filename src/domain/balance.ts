/**
 * Balance projection per TRD §3.4.
 *
 * `hcmBalance` is the authoritative HCM value for
 * (employeeId, locationId, leaveType). Local overlays — pending
 * reservations and approved-not-yet-pushed deductions — are
 * subtracted to produce the *available* balance visible to an
 * employee and checked on approval.
 */
export interface BalanceProjectionInput {
  hcmBalance: number;
  pendingDays: number;
  approvedNotYetPushedDays: number;
}

export function availableBalance(input: BalanceProjectionInput): number {
  return input.hcmBalance - input.pendingDays - input.approvedNotYetPushedDays;
}

export function hasSufficientBalance(
  input: BalanceProjectionInput,
  requestedDays: number,
): boolean {
  return availableBalance(input) >= requestedDays;
}
