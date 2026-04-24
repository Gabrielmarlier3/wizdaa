import request from 'supertest';
import { balances } from '../../src/database/schema';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('POST /requests', () => {
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

  it('creates a pending request with a balance hold when balance is sufficient', async () => {
    seedBalance('emp-001', 'loc-BR', 'PTO', 10);

    const response = await request(ctx.app.getHttpServer())
      .post('/requests')
      .send({
        employeeId: 'emp-001',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days: 2,
        clientRequestId: 'req-uuid-001',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      status: 'pending',
      employeeId: 'emp-001',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
      clientRequestId: 'req-uuid-001',
    });
  });
});
