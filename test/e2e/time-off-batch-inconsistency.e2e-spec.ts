import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import {
  approvedDeductions,
  balances,
  hcmOutbox,
  inconsistencies,
  requests,
} from '../../src/database/schema';
import { buildTestApp, TestContext } from '../helpers/test-app';

/**
 * End-to-end user journey: an approved-not-yet-pushed deduction
 * remains in the overlay until HCM acknowledges it; a batch that
 * lowers the HCM balance below that deduction flags the dimension;
 * the flagged dimension blocks further approvals; a clean batch
 * auto-clears the flag and the next approve succeeds (TRD §3.5
 * + §9 decision 14).
 *
 * The first "approved-not-yet-pushed" state is seeded directly
 * against the DB rather than driven through the approve flow with
 * a forced HCM failure — the test's intent is "halt + auto-clear
 * through the HTTP surface", and coupling the scenario to the
 * mock's transient-failure injection would let a mock regression
 * mask a halt regression.
 */
describe('batch intake ↔ approve halt ↔ auto-clear', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await fetch(`${process.env.HCM_MOCK_URL}/test/reset`, { method: 'POST' });
  });

  afterEach(async () => {
    await ctx.close();
  });

  const dim = {
    employeeId: 'emp-flow',
    locationId: 'loc-BR',
    leaveType: 'PTO',
  } as const;

  function seedBalance(hcmBalance: number): void {
    ctx.db
      .insert(balances)
      .values({
        ...dim,
        hcmBalance,
        updatedAt: new Date().toISOString(),
      })
      .run();
  }

  function seedApprovedNotYetPushed(days: number): void {
    const requestId = randomUUID();
    ctx.db
      .insert(requests)
      .values({
        id: requestId,
        ...dim,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days,
        status: 'approved',
        hcmSyncStatus: 'pending',
        clientRequestId: `client-seeded-${requestId}`,
        createdAt: new Date().toISOString(),
      })
      .run();
    ctx.db
      .insert(approvedDeductions)
      .values({
        id: randomUUID(),
        requestId,
        ...dim,
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
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  function getInconsistency() {
    return ctx.db
      .select()
      .from(inconsistencies)
      .where(
        and(
          eq(inconsistencies.employeeId, dim.employeeId),
          eq(inconsistencies.locationId, dim.locationId),
          eq(inconsistencies.leaveType, dim.leaveType),
        ),
      )
      .get();
  }

  async function createPending(clientRequestId: string, days: number) {
    const res = await request(ctx.app.getHttpServer())
      .post('/requests')
      .send({
        ...dim,
        startDate: '2026-05-10',
        endDate: '2026-05-11',
        days,
        clientRequestId,
      });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it('halts approvals on flagged dimensions and resumes them when a clean batch clears the flag', async () => {
    seedBalance(10);
    // Six approved days already committed locally; their outbox
    // row is still pending so they count toward
    // approvedNotYetPushedDays.
    seedApprovedNotYetPushed(6);

    const pending = await createPending('client-flow-halt', 2);

    // HCM sends a lower balance. Predicate 4 − 6 = −2 < 0 → flag.
    const shrink = await request(ctx.app.getHttpServer())
      .post('/hcm/balances/batch')
      .send({
        generatedAt: '2026-04-24T12:00:00.000Z',
        balances: [{ ...dim, balance: 4 }],
      });
    expect(shrink.status).toBe(201);
    expect(shrink.body).toEqual({ replaced: 1, inconsistenciesDetected: 1 });
    expect(getInconsistency()).toBeDefined();

    const halted = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();
    expect(halted.status).toBe(409);
    expect(halted.body).toMatchObject({
      code: 'DIMENSION_INCONSISTENT',
      ...dim,
    });

    // HCM restores the balance. Predicate 10 − 6 = 4 ≥ 0 → clear.
    const restore = await request(ctx.app.getHttpServer())
      .post('/hcm/balances/batch')
      .send({
        generatedAt: '2026-04-24T13:00:00.000Z',
        balances: [{ ...dim, balance: 10 }],
      });
    expect(restore.status).toBe(201);
    expect(restore.body).toEqual({ replaced: 1, inconsistenciesDetected: 0 });
    expect(getInconsistency()).toBeUndefined();

    const resumed = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({
      status: 'approved',
      hcmSyncStatus: 'synced',
    });
  });
});
