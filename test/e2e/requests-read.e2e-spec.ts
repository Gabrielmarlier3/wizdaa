import request from 'supertest';
import { balances } from '../../src/database/schema';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('GET /requests/:id', () => {
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

  it('returns the full request entity for a known id', async () => {
    seedBalance('emp-read-01', 'loc-BR', 'PTO', 10);
    const createBody = {
      employeeId: 'emp-read-01',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
      clientRequestId: 'client-read-01',
    };
    const created = await request(ctx.app.getHttpServer())
      .post('/requests')
      .send(createBody);
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const response = await request(ctx.app.getHttpServer()).get(
      `/requests/${id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(created.body);
  });

  it('returns 404 REQUEST_NOT_FOUND for an unknown id', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';

    const response = await request(ctx.app.getHttpServer()).get(
      `/requests/${unknownId}`,
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: 'REQUEST_NOT_FOUND',
    });
  });
});
