import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hcmOutbox, requests } from '../../src/database/schema';
import { HcmOutboxRepository } from '../../src/hcm/repositories/hcm-outbox.repository';
import { buildTestApp, TestContext } from '../helpers/test-app';

/**
 * Repo-level guard: once a row is terminal (`synced` or
 * `failed_permanent`), no subsequent mark* method can move it
 * back to a non-terminal state. Covers the race between a
 * delayed inline push and a worker tick that both try to
 * resolve the same outbox row (plan 009 Appendix A R5).
 */
describe('HcmOutboxRepository terminal-state guards', () => {
  let ctx: TestContext;
  let repo: HcmOutboxRepository;

  beforeEach(async () => {
    ctx = await buildTestApp();
    repo = ctx.app.get(HcmOutboxRepository);
  });

  afterEach(async () => {
    await ctx.close();
  });

  type TerminalStatus = 'synced' | 'failed_permanent';

  function seedTerminalOutboxRow(status: TerminalStatus): {
    outboxId: string;
    requestId: string;
  } {
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
        hcmSyncStatus: status === 'synced' ? 'synced' : 'failed',
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
        status,
        attempts: 1,
        nextAttemptAt: new Date().toISOString(),
        hcmMutationId: status === 'synced' ? 'hcm-mut-seed' : null,
        syncedAt: status === 'synced' ? new Date().toISOString() : null,
        lastError: status === 'failed_permanent' ? 'HCM 409 seeded' : null,
      })
      .run();
    return { outboxId, requestId };
  }

  it('leaves a synced row untouched when markFailedRetryable is called', () => {
    const { outboxId } = seedTerminalOutboxRow('synced');

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
    const { outboxId } = seedTerminalOutboxRow('synced');

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

  it('leaves a failed_permanent row untouched when markFailedRetryable is called', () => {
    const { outboxId } = seedTerminalOutboxRow('failed_permanent');

    repo.markFailedRetryable(
      outboxId,
      'stale retry loser',
      new Date(Date.now() + 30_000).toISOString(),
    );

    const row = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.id, outboxId))
      .get();
    expect(row?.status).toBe('failed_permanent');
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe('HCM 409 seeded');
  });

  it('leaves a failed_permanent row untouched when markFailedPermanent is called again', () => {
    const { outboxId } = seedTerminalOutboxRow('failed_permanent');

    repo.markFailedPermanent(outboxId, 'stale permanent loser');

    const row = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.id, outboxId))
      .get();
    expect(row?.status).toBe('failed_permanent');
    expect(row?.lastError).toBe('HCM 409 seeded');
  });

  it('leaves a failed_permanent row untouched when markSynced races to write', () => {
    // Closes the symmetric-guard gap surfaced by the project-wide
    // audit: markSynced previously wrote unconditionally and
    // would have overwritten a permanent failure with a synced
    // outcome — masking a 4xx HCM rejection.
    const { outboxId } = seedTerminalOutboxRow('failed_permanent');

    repo.markSynced(outboxId, 'late-arriving-mut-id', new Date().toISOString());

    const row = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.id, outboxId))
      .get();
    expect(row?.status).toBe('failed_permanent');
    expect(row?.lastError).toBe('HCM 409 seeded');
    expect(row?.hcmMutationId).toBeNull();
    expect(row?.syncedAt).toBeNull();
  });
});
