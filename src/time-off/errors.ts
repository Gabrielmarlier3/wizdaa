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
