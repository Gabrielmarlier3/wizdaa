import request from 'supertest';
import { balances } from '../../src/database/schema';
import { buildTestApp, TestContext } from '../helpers/test-app';

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
});
