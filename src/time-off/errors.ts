/**
 * Shared domain errors for the time-off module. Lives here so no
 * single use case owns the class by accident — any downstream use
 * case (approve, reject, cancel, …) can import from one stable
 * location.
 */

export class RequestNotFoundError extends Error {
  constructor(id: string) {
    super(`Request not found: ${id}`);
    this.name = 'RequestNotFoundError';
  }
}

/**
 * Raised when a pending → approved transition targets a dimension
 * flagged as inconsistent by the most recent HCM batch (TRD §3.5 /
 * §9 decision 14). The dimension is carried on the instance so the
 * HTTP layer can surface it in the error envelope, following the
 * same shape precedent as BalanceNotFoundError.
 */
export class DimensionInconsistentError extends Error {
  constructor(
    public readonly employeeId: string,
    public readonly locationId: string,
    public readonly leaveType: string,
  ) {
    super(
      `Dimension (${employeeId}, ${locationId}, ${leaveType}) is flagged inconsistent; approvals halted until HCM sends a clean batch.`,
    );
    this.name = 'DimensionInconsistentError';
  }
}
