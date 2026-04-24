import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hcmOutbox, requests } from '../../src/database/schema';
import { HcmOutboxRepository } from '../../src/time-off/repositories/hcm-outbox.repository';
import { buildTestApp, TestContext } from '../helpers/test-app';

/**
 * Repo-level guard: once a row is `synced`, no subsequent mark*
 * method can move it to a non-terminal state. Covers the race
 * between a delayed inline push and a worker tick that both try
 * to resolve the same outbox row (plan 009 Appendix A R5).
 */
describe('HcmOutboxRepository synced-row guards', () => {
  let ctx: TestContext;
  let repo: HcmOutboxRepository;

  beforeEach(async () => {
    ctx = await buildTestApp();
    repo = ctx.app.get(HcmOutboxRepository);
  });

  afterEach(async () => {
    await ctx.close();
  });

  function seedSyncedOutboxRow(): { outboxId: string; requestId: string } {
    const requestId = randomUUID();
    const outboxId = randomUUID();
    ctx.db
      .insert(requests)
      .values({
        id: requestId,
        employeeId: 'emp-guard',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days: 2,
        status: 'approved',
        hcmSyncStatus: 'synced',
        clientRequestId: `client-${requestId}`,
        createdAt: new Date().toISOString(),
      })
      .run();
    ctx.db
      .insert(hcmOutbox)
      .values({
        id: outboxId,
        requestId,
        idempotencyKey: randomUUID(),
        payloadJson: '{}',
        status: 'synced',
        attempts: 1,
        nextAttemptAt: new Date().toISOString(),
        hcmMutationId: 'hcm-mut-seed',
        syncedAt: new Date().toISOString(),
      })
      .run();
    return { outboxId, requestId };
  }

  it('leaves a synced row untouched when markFailedRetryable is called', () => {
    const { outboxId } = seedSyncedOutboxRow();

    repo.markFailedRetryable(
      outboxId,
      'late writer race',
      new Date(Date.now() + 30_000).toISOString(),
    );

    const row = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.id, outboxId))
      .get();
    expect(row?.status).toBe('synced');
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBeNull();
    expect(row?.hcmMutationId).toBe('hcm-mut-seed');
  });

  it('leaves a synced row untouched when markFailedPermanent is called', () => {
    const { outboxId } = seedSyncedOutboxRow();

    repo.markFailedPermanent(outboxId, 'late writer race');

    const row = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.id, outboxId))
      .get();
    expect(row?.status).toBe('synced');
    expect(row?.lastError).toBeNull();
    expect(row?.hcmMutationId).toBe('hcm-mut-seed');
  });
});
