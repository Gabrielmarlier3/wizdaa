import { Inject, Injectable, Logger } from '@nestjs/common';

export const HCM_BASE_URL = Symbol('HCM_BASE_URL');
export const HCM_TIMEOUT_MS = Symbol('HCM_TIMEOUT_MS');

export interface HcmMutationInput {
  employeeId: string;
  locationId: string;
  leaveType: string;
  /** Signed day count; approvals push negative. */
  days: number;
  reason: string;
  /** Outbox id — HCM echoes this back for audit linkage. */
  clientMutationId: string;
  /** Service-generated UUID, sent as `Idempotency-Key` header. */
  idempotencyKey: string;
}

export type HcmMutationResult =
  | { kind: 'ok'; hcmMutationId: string }
  | { kind: 'permanent'; status: number; body: unknown }
  | { kind: 'transient'; reason: string };

/**
 * Thin HTTP wrapper around the HCM mutation endpoint (TRD §3.2).
 * Returns a discriminated union that collapses every transport and
 * HTTP-status failure mode into the three outbox-lifecycle branches
 * the approve use case cares about: `ok` → synced, `permanent` →
 * failed_permanent, `transient` → failed_retryable.
 */
@Injectable()
export class HcmClient {
  private readonly logger = new Logger(HcmClient.name);

  constructor(
    @Inject(HCM_BASE_URL) private readonly baseUrl: string,
    @Inject(HCM_TIMEOUT_MS) private readonly timeoutMs: number,
  ) {}

  async postMutation(input: HcmMutationInput): Promise<HcmMutationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/balance/mutations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          employeeId: input.employeeId,
          locationId: input.locationId,
          leaveType: input.leaveType,
          days: input.days,
          reason: input.reason,
          clientMutationId: input.clientMutationId,
        }),
        signal: controller.signal,
      });

      if (response.status >= 500) {
        return { kind: 'transient', reason: `HCM ${response.status}` };
      }

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // fall through — empty / non-JSON body
      }

      if (response.status >= 400) {
        return { kind: 'permanent', status: response.status, body };
      }

      if (
        typeof body !== 'object' ||
        body === null ||
        typeof (body as { hcmMutationId?: unknown }).hcmMutationId !== 'string'
      ) {
        // §3.5 — HCM accepts what we would reject; never mark synced
        // on a malformed 2xx.
        return { kind: 'transient', reason: 'malformed HCM response' };
      }

      return {
        kind: 'ok',
        hcmMutationId: (body as { hcmMutationId: string }).hcmMutationId,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { kind: 'transient', reason: 'timeout' };
      }
      this.logger.warn(`HCM call error: ${String(err)}`);
      return { kind: 'transient', reason: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
}
