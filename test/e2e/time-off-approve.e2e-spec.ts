import request from 'supertest';
import { balances, hcmOutbox } from '../../src/database/schema';
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
  const response = await fetch(
    `${process.env.HCM_MOCK_URL}/test/scenario`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    },
  );
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
});
