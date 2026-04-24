export class BalanceNotFoundError extends Error {
  constructor(
    public readonly employeeId: string,
    public readonly locationId: string,
    public readonly leaveType: string,
  ) {
    super(
      `No balance record for (${employeeId}, ${locationId}, ${leaveType})`,
    );
    this.name = 'BalanceNotFoundError';
  }
}
