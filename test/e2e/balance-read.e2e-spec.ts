import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  approvedDeductions,
  balances,
  hcmOutbox,
  holds,
  requests,
} from '../../src/database/schema';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('GET /balance', () => {
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

  /**
   * Seeds overlay ledger rows directly against the DB so this spec
   * isolates the read-side projection from the write flows. Using
   * the approve use case here would require flipping the mock HCM
   * scenario to force500, and the mock is a shared singleton across
   * the e2e suite (Jest globalSetup starts it once) — flipping the
   * scenario here would race with approve specs running in
   * parallel test files. Direct seeding is the correct isolation.
   */
  function seedPendingHold(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): void {
    const requestId = randomUUID();
    ctx.db
      .insert(requests)
      .values({
        id: requestId,
        employeeId,
        locationId,
        leaveType,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days,
        status: 'pending',
        hcmSyncStatus: 'not_required',
        clientRequestId: `client-${requestId}`,
        createdAt: new Date().toISOString(),
      })
      .run();
    ctx.db
      .insert(holds)
      .values({
        id: randomUUID(),
        requestId,
        employeeId,
        locationId,
        leaveType,
        days,
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  function seedApprovedNotYetPushedDeduction(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): void {
    const requestId = randomUUID();
    ctx.db
      .insert(requests)
      .values({
        id: requestId,
        employeeId,
        locationId,
        leaveType,
        startDate: '2026-05-03',
        endDate: '2026-05-04',
        days,
        status: 'approved',
        hcmSyncStatus: 'pending',
        clientRequestId: `client-${requestId}`,
        createdAt: new Date().toISOString(),
      })
      .run();
    ctx.db
      .insert(approvedDeductions)
      .values({
        id: randomUUID(),
        requestId,
        employeeId,
        locationId,
        leaveType,
        days,
        createdAt: new Date().toISOString(),
      })
      .run();
    ctx.db
      .insert(hcmOutbox)
      .values({
        id: randomUUID(),
        requestId,
        idempotencyKey: randomUUID(),
        payloadJson: '{}',
        // 'pending' is the natural pre-push state and the simpler
        // case the projection filter covers — the test's intent is
        // "deduction visible while the push hasn't succeeded yet".
        // 'failed_retryable' would equally pass the filter but
        // conflates "hasn't been pushed" with "was attempted and
        // failed", and would silently break if future slices add
        // NOT NULL constraints on last_error / attempts.
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  it('returns the overlay breakdown for a seeded dimension with pending and approved rows', async () => {
    seedBalance('emp-balance-01', 'loc-BR', 'PTO', 10);
    seedPendingHold('emp-balance-01', 'loc-BR', 'PTO', 2);
    seedApprovedNotYetPushedDeduction('emp-balance-01', 'loc-BR', 'PTO', 3);

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
