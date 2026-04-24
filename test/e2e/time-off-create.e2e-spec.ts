import request from 'supertest';
import { balances, holds } from '../../src/database/schema';
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

  it('returns the existing request on a duplicate clientRequestId and does not create a second hold', async () => {
    seedBalance('emp-002', 'loc-BR', 'PTO', 10);

    const body = {
      employeeId: 'emp-002',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-10',
      endDate: '2026-05-11',
      days: 2,
      clientRequestId: 'req-uuid-dup',
    };

    const first = await request(ctx.app.getHttpServer())
      .post('/requests')
      .send(body);
    const second = await request(ctx.app.getHttpServer())
      .post('/requests')
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body).toEqual(first.body);

    const allHolds = ctx.db.select().from(holds).all();
    expect(allHolds).toHaveLength(1);
  });

  it('rejects with 409 Conflict when balance is insufficient', async () => {
    seedBalance('emp-003', 'loc-BR', 'PTO', 1);

    const response = await request(ctx.app.getHttpServer())
      .post('/requests')
      .send({
        employeeId: 'emp-003',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        days: 3,
        clientRequestId: 'req-uuid-over',
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      code: 'INSUFFICIENT_BALANCE',
      message: expect.any(String),
    });

    const allHolds = ctx.db.select().from(holds).all();
    expect(allHolds).toHaveLength(0);
  });
});
