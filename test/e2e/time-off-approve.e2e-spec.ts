import request from 'supertest';
import {
  approvedDeductions,
  balances,
  hcmOutbox,
  holds,
} from '../../src/database/schema';
import { eq } from 'drizzle-orm';
import { buildTestApp, TestContext } from '../helpers/test-app';

async function setScenario(
  mode:
    | 'normal'
    | 'force500'
    | 'forceTimeout'
    | 'forcePermanent'
    | 'forceBadShape',
): Promise<void> {
  const response = await fetch(`${process.env.HCM_MOCK_URL}/test/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (response.status !== 204) {
    throw new Error(`Failed to set scenario: ${response.status}`);
  }
}

describe('POST /requests/:id/approve', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestApp();
    // Reset mock HCM state between tests so previous idempotency keys
    // and scenario overrides do not leak.
    await fetch(`${process.env.HCM_MOCK_URL}/test/reset`, {
      method: 'POST',
    });
  });

  afterEach(async () => {
    await ctx.close();
  });

  function seedBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    hcmBalance: number,
  ): void {
    ctx.db
      .insert(balances)
      .values({
        employeeId,
        locationId,
        leaveType,
        hcmBalance,
        updatedAt: new Date().toISOString(),
      })
      .run();
  }

  async function createPendingRequest(overrides?: {
    employeeId?: string;
    locationId?: string;
    leaveType?: string;
    days?: number;
    clientRequestId?: string;
  }): Promise<{ id: string }> {
    const body = {
      employeeId: overrides?.employeeId ?? 'emp-approve-01',
      locationId: overrides?.locationId ?? 'loc-BR',
      leaveType: overrides?.leaveType ?? 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: overrides?.days ?? 2,
      clientRequestId: overrides?.clientRequestId ?? 'client-approve-01',
    };
    const response = await request(ctx.app.getHttpServer())
      .post('/requests')
      .send(body);
    expect(response.status).toBe(201);
    return { id: response.body.id as string };
  }

  it('approves a pending request and marks it synced when HCM accepts the push', async () => {
    seedBalance('emp-approve-01', 'loc-BR', 'PTO', 10);
    const pending = await createPendingRequest();

    const response = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: pending.id,
      status: 'approved',
      hcmSyncStatus: 'synced',
    });
  });

  it('leaves approval locally committed with hcmSyncStatus=pending when HCM returns 500', async () => {
    seedBalance('emp-approve-02', 'loc-BR', 'PTO', 10);
    const pending = await createPendingRequest({
      employeeId: 'emp-approve-02',
      clientRequestId: 'client-approve-02',
    });
    await setScenario('force500');

    const response = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: pending.id,
      status: 'approved',
      hcmSyncStatus: 'pending',
    });

    const outboxRow = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.requestId, pending.id))
      .get();
    expect(outboxRow).toBeDefined();
    expect(outboxRow?.status).toBe('failed_retryable');
    expect(outboxRow?.attempts).toBe(1);
    expect(outboxRow?.lastError).toMatch(/500/);
  });

  it('flags the request as failed when HCM rejects the mutation permanently', async () => {
    seedBalance('emp-approve-03', 'loc-BR', 'PTO', 10);
    const pending = await createPendingRequest({
      employeeId: 'emp-approve-03',
      clientRequestId: 'client-approve-03',
    });
    await setScenario('forcePermanent');

    const response = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();

    // Local approval stands; only the sync status reflects that
    // HCM refused the mutation (TRD §8.3 — our truth wins locally).
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: pending.id,
      status: 'approved',
      hcmSyncStatus: 'failed',
    });

    const outboxRow = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.requestId, pending.id))
      .get();
    expect(outboxRow?.status).toBe('failed_permanent');
    expect(outboxRow?.lastError).toMatch(/409/);
  });

  it('treats a 2xx with malformed body as a retryable transient failure', async () => {
    seedBalance('emp-badshape', 'loc-BR', 'PTO', 10);
    const pending = await createPendingRequest({
      employeeId: 'emp-badshape',
      clientRequestId: 'client-badshape-01',
    });
    await setScenario('forceBadShape');

    const response = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();

    // R5 path: HCM accepts with an unparseable body; never mark
    // synced. Local approval stands; the outbox stays retryable so
    // a later attempt against a fixed HCM can succeed.
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: pending.id,
      status: 'approved',
      hcmSyncStatus: 'pending',
    });

    const outboxRow = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.requestId, pending.id))
      .get();
    expect(outboxRow?.status).toBe('failed_retryable');
    expect(outboxRow?.lastError).toMatch(/malformed/i);
    expect(outboxRow?.attempts).toBe(1);
  });

  it('classifies an HCM call that exceeds the timeout budget as transient and keeps the outbox retryable', async () => {
    seedBalance('emp-timeout', 'loc-BR', 'PTO', 10);
    const pending = await createPendingRequest({
      employeeId: 'emp-timeout',
      clientRequestId: 'client-timeout-01',
    });
    await setScenario('forceTimeout');

    const response = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();

    // HcmClient's AbortController fires at HCM_TIMEOUT_MS (default
    // 2000ms). Aborted fetch becomes 'transient' with reason
    // 'timeout' (TRD §5) — local approval stands, outbox stays
    // retryable for the worker to drain once HCM is healthy again.
    // Reset the scenario back to 'normal' so subsequent specs in
    // the file do not hold their connections open waiting on the
    // mock's 30s timeout branch.
    await setScenario('normal');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: pending.id,
      status: 'approved',
      hcmSyncStatus: 'pending',
    });

    const outboxRow = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.requestId, pending.id))
      .get();
    expect(outboxRow?.status).toBe('failed_retryable');
    // The HcmClient classifies the abort as either 'timeout' (when
    // err.name === 'AbortError' surfaces cleanly) or 'network' (when
    // the underlying fetch wraps the abort as a TypeError/DOMException
    // depending on the runtime). Both are valid transient outcomes
    // for §15's "HCM timeout" scenario — the §15 invariant is that
    // the outbox stays retryable, not the exact reason string.
    expect(outboxRow?.lastError).toMatch(/timeout|network/i);
    expect(outboxRow?.attempts).toBe(1);
  }, 10_000);

  it('serialises concurrent approvals so one wins and the other returns INVALID_TRANSITION', async () => {
    seedBalance('emp-concurrent', 'loc-BR', 'PTO', 10);
    const pending = await createPendingRequest({
      employeeId: 'emp-concurrent',
      clientRequestId: 'client-concurrent-01',
    });

    // Two parallel approvals. better-sqlite3 serialises them at the
    // driver level; the use case's UPDATE ... WHERE status='pending'
    // guard is what decides the winner deterministically.
    const [first, second] = await Promise.all([
      request(ctx.app.getHttpServer())
        .post(`/requests/${pending.id}/approve`)
        .send(),
      request(ctx.app.getHttpServer())
        .post(`/requests/${pending.id}/approve`)
        .send(),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = first.status === 409 ? first : second;
    expect(loser.body).toMatchObject({
      code: 'INVALID_TRANSITION',
      currentStatus: 'approved',
    });

    // Exactly one of each ledger line — the primary fence prevented
    // the double-approve and the secondary UNIQUE(hcm_outbox.request_id)
    // would have caught it otherwise.
    const deds = ctx.db
      .select()
      .from(approvedDeductions)
      .where(eq(approvedDeductions.requestId, pending.id))
      .all();
    expect(deds).toHaveLength(1);

    const outboxRows = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.requestId, pending.id))
      .all();
    expect(outboxRows).toHaveLength(1);

    const holdRows = ctx.db
      .select()
      .from(holds)
      .where(eq(holds.requestId, pending.id))
      .all();
    expect(holdRows).toHaveLength(0);
  });

  it('returns 409 INVALID_TRANSITION with the current status on idempotent replay', async () => {
    seedBalance('emp-replay', 'loc-BR', 'PTO', 10);
    const pending = await createPendingRequest({
      employeeId: 'emp-replay',
      clientRequestId: 'client-replay-01',
    });

    const first = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();
    expect(first.status).toBe(200);
    expect(first.body.hcmSyncStatus).toBe('synced');

    const second = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      code: 'INVALID_TRANSITION',
      currentStatus: 'approved',
    });

    // No second outbox row and no second HCM call — the replay
    // short-circuits before even reaching the transaction's
    // state-changing writes.
    const outboxRows = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.requestId, pending.id))
      .all();
    expect(outboxRows).toHaveLength(1);

    const mockState = await (
      await fetch(`${process.env.HCM_MOCK_URL}/test/state`)
    ).json();
    expect(mockState.mutations).toHaveLength(1);
  });
});
