import { eq } from 'drizzle-orm';
import request from 'supertest';
import { balances, holds } from '../../src/database/schema';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('POST /requests/:id/cancel', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestApp();
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
    clientRequestId?: string;
  }): Promise<{ id: string }> {
    const body = {
      employeeId: overrides?.employeeId ?? 'emp-cancel-01',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
      clientRequestId: overrides?.clientRequestId ?? 'client-cancel-01',
    };
    const response = await request(ctx.app.getHttpServer())
      .post('/requests')
      .send(body);
    expect(response.status).toBe(201);
    return { id: response.body.id as string };
  }

  it('cancels a pending request and releases the balance hold', async () => {
    seedBalance('emp-cancel-01', 'loc-BR', 'PTO', 10);
    const pending = await createPendingRequest();

    const response = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/cancel`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: pending.id,
      status: 'cancelled',
      hcmSyncStatus: 'not_required',
    });

    // Hold released atomically with the status change.
    const holdRow = ctx.db
      .select()
      .from(holds)
      .where(eq(holds.requestId, pending.id))
      .get();
    expect(holdRow).toBeUndefined();
  });
});
