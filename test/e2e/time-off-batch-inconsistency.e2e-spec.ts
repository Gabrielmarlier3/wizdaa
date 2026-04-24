import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { balances, inconsistencies } from '../../src/database/schema';
import { buildTestApp, TestContext } from '../helpers/test-app';

type Scenario =
  | 'normal'
  | 'force500'
  | 'forceTimeout'
  | 'forcePermanent'
  | 'forceBadShape';

async function setScenario(mode: Scenario): Promise<void> {
  const res = await fetch(`${process.env.HCM_MOCK_URL}/test/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (res.status !== 204) {
    throw new Error(`setScenario ${mode}: ${res.status}`);
  }
}

/**
 * End-to-end user journey: an approved-not-yet-pushed deduction
 * remains in the overlay until HCM acknowledges it; a batch that
 * lowers the HCM balance below that deduction flags the dimension;
 * the flagged dimension blocks further approvals; a clean batch
 * auto-clears the flag and the next approve succeeds (TRD §3.5
 * + §9 decision 14).
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

  function seedBalance(hcmBalance: number): void {
    ctx.db
      .insert(balances)
      .values({
        employeeId: 'emp-flow',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        hcmBalance,
        updatedAt: new Date().toISOString(),
      })
      .run();
  }

  function getInconsistency() {
    return ctx.db
      .select()
      .from(inconsistencies)
      .where(
        and(
          eq(inconsistencies.employeeId, 'emp-flow'),
          eq(inconsistencies.locationId, 'loc-BR'),
          eq(inconsistencies.leaveType, 'PTO'),
        ),
      )
      .get();
  }

  async function createPending(clientRequestId: string, days: number) {
    const res = await request(ctx.app.getHttpServer())
      .post('/requests')
      .send({
        employeeId: 'emp-flow',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days,
        clientRequestId,
      });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it('halts approvals on flagged dimensions and resumes them when a clean batch clears the flag', async () => {
    seedBalance(10);

    const first = await createPending('client-flow-first', 6);

    // Force the first approve's inline HCM push to fail transiently
    // so its outbox stays non-synced and the approved deduction keeps
    // counting in the overlay — otherwise the §3.5 predicate never
    // fires in the next step.
    await setScenario('force500');
    const firstApprove = await request(ctx.app.getHttpServer())
      .post(`/requests/${first.id}/approve`)
      .send();
    expect(firstApprove.status).toBe(200);
    expect(firstApprove.body).toMatchObject({
      status: 'approved',
      hcmSyncStatus: 'pending',
    });
    await setScenario('normal');

    const second = await createPending('client-flow-second', 2);

    // Batch shrinks the HCM balance below approvedNotYetPushed=6
    // → predicate 4 − 6 = −2 < 0 → flag the dimension.
    const shrink = await request(ctx.app.getHttpServer())
      .post('/hcm/balances/batch')
      .send({
        generatedAt: '2026-04-24T12:00:00.000Z',
        balances: [
          {
            employeeId: 'emp-flow',
            locationId: 'loc-BR',
            leaveType: 'PTO',
            balance: 4,
          },
        ],
      });
    expect(shrink.status).toBe(201);
    expect(shrink.body).toEqual({ replaced: 1, inconsistenciesDetected: 1 });
    expect(getInconsistency()).toBeDefined();

    const haltedApprove = await request(ctx.app.getHttpServer())
      .post(`/requests/${second.id}/approve`)
      .send();
    expect(haltedApprove.status).toBe(409);
    expect(haltedApprove.body).toMatchObject({
      code: 'DIMENSION_INCONSISTENT',
      employeeId: 'emp-flow',
      locationId: 'loc-BR',
      leaveType: 'PTO',
    });

    // Clean batch — balance 10 restored → 10 − 6 = 4 ≥ 0 → predicate
    // does not fire → auto-clear.
    const restore = await request(ctx.app.getHttpServer())
      .post('/hcm/balances/batch')
      .send({
        generatedAt: '2026-04-24T13:00:00.000Z',
        balances: [
          {
            employeeId: 'emp-flow',
            locationId: 'loc-BR',
            leaveType: 'PTO',
            balance: 10,
          },
        ],
      });
    expect(restore.status).toBe(201);
    expect(restore.body).toEqual({ replaced: 1, inconsistenciesDetected: 0 });
    expect(getInconsistency()).toBeUndefined();

    const resumed = await request(ctx.app.getHttpServer())
      .post(`/requests/${second.id}/approve`)
      .send();
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({
      status: 'approved',
      hcmSyncStatus: 'synced',
    });
  });
});
