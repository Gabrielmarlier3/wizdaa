import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  balances,
  hcmOutbox,
  requests,
} from '../../src/database/schema';
import {
  HcmOutboxWorker,
  MAX_ATTEMPTS,
} from '../../src/hcm/hcm-outbox-worker';
import { buildTestApp, TestContext } from '../helpers/test-app';

type Scenario =
  | 'normal'
  | 'force500'
  | 'forceTimeout'
  | 'forcePermanent'
  | 'forceBadShape';

async function setScenario(mode: Scenario): Promise<void> {
  const res = await fetch(`${process.env.HCM_MOCK_URL}/test/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (res.status !== 204) {
    throw new Error(`Failed to set scenario ${mode}: ${res.status}`);
  }
}

async function resetMock(): Promise<void> {
  await fetch(`${process.env.HCM_MOCK_URL}/test/reset`, { method: 'POST' });
}

/**
 * Drives HcmOutboxWorker.tick() directly against a real DB + the
 * standalone mock HCM. Each test seeds outbox rows that would, in
 * production, have been left behind by a failing inline push from
 * ApproveRequestUseCase. The tick() call is the recovery path.
 */
describe('HcmOutboxWorker.tick() (e2e against real DB + mock HCM)', () => {
  let ctx: TestContext;
  let worker: HcmOutboxWorker;

  beforeEach(async () => {
    ctx = await buildTestApp();
    worker = ctx.app.get(HcmOutboxWorker);
    await resetMock();
  });

  afterEach(async () => {
    await ctx.close();
  });

  interface SeedRow {
    status?: 'pending' | 'failed_retryable' | 'synced';
    attempts?: number;
    nextAttemptAt?: string;
    days?: number;
    employeeId?: string;
  }

  function seedOutboxRow(overrides: SeedRow = {}): {
    outboxId: string;
    requestId: string;
    idempotencyKey: string;
  } {
    const employeeId = overrides.employeeId ?? 'emp-worker-01';
    // Balance is not required for the worker path — the mock HCM
    // does not consult it — but seeding one keeps the row's FK
    // shape realistic.
    ctx.db
      .insert(balances)
      .values({
        employeeId,
        locationId: 'loc-BR',
        leaveType: 'PTO',
        hcmBalance: 10,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run();

    const requestId = randomUUID();
    const outboxId = randomUUID();
    const idempotencyKey = randomUUID();
    const days = overrides.days ?? 2;

    ctx.db
      .insert(requests)
      .values({
        id: requestId,
        employeeId,
        locationId: 'loc-BR',
        leaveType: 'PTO',
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days,
        status: 'approved',
        hcmSyncStatus: 'pending',
        clientRequestId: `client-${requestId}`,
        createdAt: new Date().toISOString(),
      })
      .run();

    ctx.db
      .insert(hcmOutbox)
      .values({
        id: outboxId,
        requestId,
        idempotencyKey,
        payloadJson: JSON.stringify({
          employeeId,
          locationId: 'loc-BR',
          leaveType: 'PTO',
          days: -days,
          reason: 'TIME_OFF_APPROVED',
          clientMutationId: outboxId,
        }),
        status: overrides.status ?? 'pending',
        attempts: overrides.attempts ?? 0,
        nextAttemptAt: overrides.nextAttemptAt ?? new Date().toISOString(),
      })
      .run();

    return { outboxId, requestId, idempotencyKey };
  }

  function getOutbox(outboxId: string) {
    return ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.id, outboxId))
      .get();
  }

  function getRequestSyncStatus(requestId: string): string | undefined {
    return ctx.db
      .select()
      .from(requests)
      .where(eq(requests.id, requestId))
      .get()?.hcmSyncStatus;
  }

  it('marks a pending row synced and flips hcmSyncStatus when HCM accepts', async () => {
    const { outboxId, requestId } = seedOutboxRow();

    await worker.tick();

    const row = getOutbox(outboxId);
    expect(row?.status).toBe('synced');
    expect(row?.hcmMutationId).toEqual(expect.any(String));
    expect(row?.syncedAt).toEqual(expect.any(String));
    expect(getRequestSyncStatus(requestId)).toBe('synced');
  });

  it('recovers a failed_retryable row on the next tick (idempotency-key replay)', async () => {
    const { outboxId, requestId } = seedOutboxRow({
      status: 'failed_retryable',
      attempts: 1,
    });

    await worker.tick();

    const row = getOutbox(outboxId);
    expect(row?.status).toBe('synced');
    expect(getRequestSyncStatus(requestId)).toBe('synced');
  });

  it('leaves a row failed_retryable with attempts incremented when HCM returns 500', async () => {
    const { outboxId, requestId } = seedOutboxRow({ employeeId: 'emp-worker-500' });
    await setScenario('force500');

    await worker.tick();

    const row = getOutbox(outboxId);
    expect(row?.status).toBe('failed_retryable');
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toMatch(/500/);
    // Next attempt is scheduled ~30s from now (base backoff at attempts=0).
    expect(row?.nextAttemptAt).toEqual(expect.any(String));
    expect(new Date(row!.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    // Still "pending" on the request — worker is still retrying.
    expect(getRequestSyncStatus(requestId)).toBe('pending');
  });

  it('flips the row to failed_permanent and hcmSyncStatus=failed when HCM rejects permanently', async () => {
    const { outboxId, requestId } = seedOutboxRow({ employeeId: 'emp-worker-perm' });
    await setScenario('forcePermanent');

    await worker.tick();

    const row = getOutbox(outboxId);
    expect(row?.status).toBe('failed_permanent');
    expect(row?.lastError).toMatch(/status=409/);
    expect(getRequestSyncStatus(requestId)).toBe('failed');
  });

  it('treats a 2xx with malformed body as a retryable transient failure', async () => {
    const { outboxId, requestId } = seedOutboxRow({ employeeId: 'emp-worker-badshape' });
    await setScenario('forceBadShape');

    await worker.tick();

    const row = getOutbox(outboxId);
    expect(row?.status).toBe('failed_retryable');
    expect(row?.lastError).toMatch(/malformed/i);
    expect(getRequestSyncStatus(requestId)).toBe('pending');
  });

  it('promotes to failed_permanent when the final retry also fails transiently', async () => {
    const { outboxId, requestId } = seedOutboxRow({
      employeeId: 'emp-worker-exhausted',
      status: 'failed_retryable',
      attempts: MAX_ATTEMPTS - 1,
    });
    await setScenario('force500');

    await worker.tick();

    const row = getOutbox(outboxId);
    expect(row?.status).toBe('failed_permanent');
    expect(row?.lastError).toMatch(/exhausted after 5 attempts/);
    expect(getRequestSyncStatus(requestId)).toBe('failed');
  });

  it('does not claim a row whose next_attempt_at is in the future', async () => {
    const futureNext = new Date(Date.now() + 60 * 60_000).toISOString();
    const { outboxId, requestId } = seedOutboxRow({
      employeeId: 'emp-worker-future',
      status: 'failed_retryable',
      attempts: 1,
      nextAttemptAt: futureNext,
    });

    await worker.tick();

    const row = getOutbox(outboxId);
    expect(row?.status).toBe('failed_retryable');
    expect(row?.attempts).toBe(1);
    expect(row?.nextAttemptAt).toBe(futureNext);
    expect(getRequestSyncStatus(requestId)).toBe('pending');
  });

  it('does not claim an already-synced row', async () => {
    const { outboxId } = seedOutboxRow({
      employeeId: 'emp-worker-synced',
      status: 'synced',
    });
    // Directly pin the synced terminal fields so the post-tick state
    // is unambiguous.
    ctx.db
      .update(hcmOutbox)
      .set({
        status: 'synced',
        hcmMutationId: 'hcm-mut-pre-existing',
        syncedAt: new Date().toISOString(),
      })
      .where(eq(hcmOutbox.id, outboxId))
      .run();

    await worker.tick();

    const row = getOutbox(outboxId);
    expect(row?.status).toBe('synced');
    expect(row?.hcmMutationId).toBe('hcm-mut-pre-existing');
  });
});
