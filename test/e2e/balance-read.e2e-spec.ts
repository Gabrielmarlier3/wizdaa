import request from 'supertest';
import { balances } from '../../src/database/schema';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('GET /balance', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestApp();
    // Reset mock HCM so an approve call's inline push succeeds
    // (approve is used below to exercise the approvedNotYetPushed
    // overlay).
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

  async function createPending(
    overrides: {
      employeeId: string;
      clientRequestId: string;
      days: number;
    },
  ): Promise<{ id: string }> {
    const body = {
      employeeId: overrides.employeeId,
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: overrides.days,
      clientRequestId: overrides.clientRequestId,
    };
    const response = await request(ctx.app.getHttpServer())
      .post('/requests')
      .send(body);
    expect(response.status).toBe(201);
    return { id: response.body.id as string };
  }

  it('returns the overlay breakdown for a seeded dimension with pending and approved requests', async () => {
    seedBalance('emp-balance-01', 'loc-BR', 'PTO', 10);

    // One pending request (2 days) — contributes to pendingDays.
    await createPending({
      employeeId: 'emp-balance-01',
      clientRequestId: 'client-balance-pending',
      days: 2,
    });

    // One approved request (3 days) — contributes to
    // approvedNotYetPushedDays until the HCM push marks it synced.
    // The mock defaults to 'normal' scenario on reset, so the
    // push succeeds and drops the deduction out of the projection.
    // To keep the deduction visible, force a transient failure so
    // the outbox ends at failed_retryable.
    await fetch(`${process.env.HCM_MOCK_URL}/test/scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'force500' }),
    });
    const approvedPending = await createPending({
      employeeId: 'emp-balance-01',
      clientRequestId: 'client-balance-approved',
      days: 3,
    });
    const approveResponse = await request(ctx.app.getHttpServer())
      .post(`/requests/${approvedPending.id}/approve`)
      .send();
    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.hcmSyncStatus).toBe('pending');

    const response = await request(ctx.app.getHttpServer())
      .get('/balance')
      .query({
        employeeId: 'emp-balance-01',
        locationId: 'loc-BR',
        leaveType: 'PTO',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      employeeId: 'emp-balance-01',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      hcmBalance: 10,
      pendingDays: 2,
      approvedNotYetPushedDays: 3,
      availableDays: 5,
    });
  });

  it('returns 404 BALANCE_NOT_FOUND when the dimension has no balance row', async () => {
    const response = await request(ctx.app.getHttpServer())
      .get('/balance')
      .query({
        employeeId: 'emp-missing',
        locationId: 'loc-BR',
        leaveType: 'PTO',
      });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: 'BALANCE_NOT_FOUND',
    });
  });

  it('returns 400 when a required query parameter is missing', async () => {
    const response = await request(ctx.app.getHttpServer())
      .get('/balance')
      .query({
        employeeId: 'emp-balance-01',
        leaveType: 'PTO',
        // locationId intentionally omitted
      });

    expect(response.status).toBe(400);
  });
});
