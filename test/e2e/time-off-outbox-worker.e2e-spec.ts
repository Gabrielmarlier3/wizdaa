import { eq } from 'drizzle-orm';
import request from 'supertest';
import { balances, hcmOutbox } from '../../src/database/schema';
import { HcmOutboxWorker } from '../../src/hcm/hcm-outbox-worker';
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
    throw new Error(`Failed to set scenario ${mode}: ${res.status}`);
  }
}

async function getMockMutations(): Promise<unknown[]> {
  const res = await fetch(`${process.env.HCM_MOCK_URL}/test/state`);
  const json = (await res.json()) as { mutations: unknown[] };
  return json.mutations;
}

/**
 * The user flow: approve hits transient HCM failure, response says
 * hcmSyncStatus='pending'; the worker later drains the outbox and
 * flips the request to 'synced'. These specs prove the recovery
 * path end-to-end — HTTP approve, worker.tick(), HTTP GET — so the
 * client sees the eventual-consistency story the overlay balance
 * is designed around.
 */
describe('outbox worker recovers requests stuck on transient HCM failures', () => {
  let ctx: TestContext;
  let worker: HcmOutboxWorker;

  beforeEach(async () => {
    ctx = await buildTestApp();
    worker = ctx.app.get(HcmOutboxWorker);
    await fetch(`${process.env.HCM_MOCK_URL}/test/reset`, { method: 'POST' });
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

  async function createPending(clientRequestId: string, employeeId: string) {
    const res = await request(ctx.app.getHttpServer()).post('/requests').send({
      employeeId,
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
      clientRequestId,
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it('syncs a pending-after-500 request to synced on the next tick', async () => {
    seedBalance('emp-wrecov-500', 'loc-BR', 'PTO', 10);
    const pending = await createPending('client-wrecov-500', 'emp-wrecov-500');

    await setScenario('force500');
    const approve = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();
    expect(approve.status).toBe(200);
    expect(approve.body.hcmSyncStatus).toBe('pending');

    // Inline push schedules the retry 30s in the future. Pull it
    // back to 'now' so the immediate tick() claims it — otherwise
    // the spec would block on a real wall-clock wait. The worker's
    // due-time filter is covered by hcm-outbox-worker.e2e-spec.ts.
    ctx.db
      .update(hcmOutbox)
      .set({ nextAttemptAt: new Date().toISOString() })
      .where(eq(hcmOutbox.requestId, pending.id))
      .run();

    await setScenario('normal');
    await worker.tick();

    const afterTick = await request(ctx.app.getHttpServer()).get(
      `/requests/${pending.id}`,
    );
    expect(afterTick.status).toBe(200);
    expect(afterTick.body.hcmSyncStatus).toBe('synced');

    // One mutation in the mock log — the inline 500 attempt never
    // reached the accept path (5xx is not stored), and the worker's
    // retry is the first stored mutation under this idempotency key.
    const mutations = await getMockMutations();
    expect(mutations).toHaveLength(1);
  });

  it('syncs a pending-after-badshape request to synced on the next tick', async () => {
    seedBalance('emp-wrecov-badshape', 'loc-BR', 'PTO', 10);
    const pending = await createPending(
      'client-wrecov-badshape',
      'emp-wrecov-badshape',
    );

    await setScenario('forceBadShape');
    const approve = await request(ctx.app.getHttpServer())
      .post(`/requests/${pending.id}/approve`)
      .send();
    expect(approve.status).toBe(200);
    expect(approve.body.hcmSyncStatus).toBe('pending');

    // The badShape 2xx is terminal at the mock's key-store — its
    // replay on retry also returns the malformed body, so the worker
    // classifies it as transient again. That is the correct defensive
    // read per TRD §8.3: the mock never "accepts" a mutation it could
    // not shape-check; the worker stays retryable regardless of how
    // many times it tries.
    //
    // Fix: reset the mock (drops the stored terminal outcome under
    // the key) and flip to normal. On the next tick the retry lands
    // a fresh 200 with a valid body.
    await fetch(`${process.env.HCM_MOCK_URL}/test/reset`, { method: 'POST' });
    await setScenario('normal');
    ctx.db
      .update(hcmOutbox)
      .set({ nextAttemptAt: new Date().toISOString() })
      .where(eq(hcmOutbox.requestId, pending.id))
      .run();
    await worker.tick();

    const afterTick = await request(ctx.app.getHttpServer()).get(
      `/requests/${pending.id}`,
    );
    expect(afterTick.status).toBe(200);
    expect(afterTick.body.hcmSyncStatus).toBe('synced');
  });
});
