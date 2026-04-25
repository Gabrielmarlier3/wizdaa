import { Db } from '../database/connection';
import { HcmOutboxRepository } from './repositories/hcm-outbox.repository';
import { RequestsRepository } from '../time-off/repositories/requests.repository';
import { HcmClient, HcmMutationResult } from './hcm.client';
import { HcmOutboxDueRow, HcmOutboxWorker } from './hcm-outbox-worker';

interface BuildOptions {
  dueRows?: HcmOutboxDueRow[];
  hcmResult?: HcmMutationResult;
}

interface BuildResult {
  worker: HcmOutboxWorker;
  claimDueBatchMock: jest.Mock;
  markSyncedMock: jest.Mock;
  markFailedRetryableMock: jest.Mock;
  markFailedPermanentMock: jest.Mock;
  updateHcmSyncStatusMock: jest.Mock;
  postMutationMock: jest.Mock;
}

function buildWorker(options: BuildOptions = {}): BuildResult {
  const claimDueBatchMock = jest.fn().mockReturnValue(options.dueRows ?? []);
  const markSyncedMock = jest.fn();
  const markFailedRetryableMock = jest.fn();
  const markFailedPermanentMock = jest.fn();
  const updateHcmSyncStatusMock = jest.fn();
  const postMutationMock = jest
    .fn()
    .mockResolvedValue(
      options.hcmResult ??
        ({ kind: 'ok', hcmMutationId: 'hcm-mut-1' } as const),
    );

  const outboxRepo = {
    claimDueBatch: claimDueBatchMock,
    markSynced: markSyncedMock,
    markFailedRetryable: markFailedRetryableMock,
    markFailedPermanent: markFailedPermanentMock,
  } as unknown as HcmOutboxRepository;

  const requestsRepo = {
    updateHcmSyncStatus: updateHcmSyncStatusMock,
  } as unknown as RequestsRepository;

  const hcmClient = {
    postMutation: postMutationMock,
  } as unknown as HcmClient;

  // Pass-through transaction: the repos are mocked, so the tx argument
  // is irrelevant — we just need the callback to run.
  const db = {
    transaction: <T>(fn: (tx: Db) => T): T => fn({} as unknown as Db),
  } as unknown as Db;

  const worker = new HcmOutboxWorker(db, outboxRepo, requestsRepo, hcmClient);

  return {
    worker,
    claimDueBatchMock,
    markSyncedMock,
    markFailedRetryableMock,
    markFailedPermanentMock,
    updateHcmSyncStatusMock,
    postMutationMock,
  };
}

function makeRow(overrides: Partial<HcmOutboxDueRow> = {}): HcmOutboxDueRow {
  return {
    id: 'outbox-1',
    requestId: 'req-1',
    idempotencyKey: 'idem-1',
    payloadJson: JSON.stringify({
      employeeId: 'emp-1',
      locationId: 'loc-1',
      leaveType: 'PTO',
      days: -2,
      reason: 'TIME_OFF_APPROVED',
      clientMutationId: 'outbox-1',
    }),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: '2026-04-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('HcmOutboxWorker.tick()', () => {
  it('is a no-op when no rows are due', async () => {
    const {
      worker,
      postMutationMock,
      markSyncedMock,
      updateHcmSyncStatusMock,
    } = buildWorker({ dueRows: [] });

    await worker.tick();

    expect(postMutationMock).not.toHaveBeenCalled();
    expect(markSyncedMock).not.toHaveBeenCalled();
    expect(updateHcmSyncStatusMock).not.toHaveBeenCalled();
  });

  it('marks the row synced and flips hcmSyncStatus to "synced" when HCM returns ok', async () => {
    const row = makeRow();
    const {
      worker,
      markSyncedMock,
      updateHcmSyncStatusMock,
      markFailedRetryableMock,
      markFailedPermanentMock,
    } = buildWorker({
      dueRows: [row],
      hcmResult: { kind: 'ok', hcmMutationId: 'hcm-mut-42' },
    });

    await worker.tick();

    expect(markSyncedMock).toHaveBeenCalledTimes(1);
    expect(markSyncedMock).toHaveBeenCalledWith(
      row.id,
      'hcm-mut-42',
      expect.any(String),
      expect.anything(),
    );
    expect(updateHcmSyncStatusMock).toHaveBeenCalledWith(
      row.requestId,
      'synced',
      expect.anything(),
    );
    expect(markFailedRetryableMock).not.toHaveBeenCalled();
    expect(markFailedPermanentMock).not.toHaveBeenCalled();
  });

  it('passes the stored idempotencyKey to HCM rather than generating a new one', async () => {
    const row = makeRow({ idempotencyKey: 'stored-key-from-row' });
    const { worker, postMutationMock } = buildWorker({ dueRows: [row] });

    await worker.tick();

    expect(postMutationMock).toHaveBeenCalledTimes(1);
    const args = postMutationMock.mock.calls[0][0];
    expect(args.idempotencyKey).toBe('stored-key-from-row');
    // Payload fields flow through from the stored JSON untouched.
    expect(args.employeeId).toBe('emp-1');
    expect(args.days).toBe(-2);
    expect(args.clientMutationId).toBe('outbox-1');
  });

  describe('transient branch', () => {
    const fixedNow = new Date('2026-04-24T00:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers({ now: fixedNow });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('schedules the first retry 30s out when attempts=0', async () => {
      const row = makeRow({ attempts: 0 });
      const {
        worker,
        markFailedRetryableMock,
        markFailedPermanentMock,
        updateHcmSyncStatusMock,
      } = buildWorker({
        dueRows: [row],
        hcmResult: { kind: 'transient', reason: 'HCM 500' },
      });

      await worker.tick();

      expect(markFailedRetryableMock).toHaveBeenCalledTimes(1);
      const [, reason, nextAt] = markFailedRetryableMock.mock.calls[0];
      expect(reason).toBe('HCM 500');
      expect(nextAt).toBe(new Date(fixedNow.getTime() + 30_000).toISOString());
      expect(markFailedPermanentMock).not.toHaveBeenCalled();
      // hcmSyncStatus stays 'pending' — we are still retrying.
      expect(updateHcmSyncStatusMock).not.toHaveBeenCalled();
    });

    it('applies exponential backoff (attempts=2 → 120s)', async () => {
      const row = makeRow({ attempts: 2 });
      const { worker, markFailedRetryableMock } = buildWorker({
        dueRows: [row],
        hcmResult: { kind: 'transient', reason: 'timeout' },
      });

      await worker.tick();

      const [, , nextAt] = markFailedRetryableMock.mock.calls[0];
      expect(nextAt).toBe(new Date(fixedNow.getTime() + 120_000).toISOString());
    });

    it('promotes to failed_permanent and flips hcmSyncStatus to "failed" when attempts reach MAX_ATTEMPTS', async () => {
      // attempts=4 is the final retryable state; the next transient
      // failure is the fifth and final attempt, promoted to permanent.
      const row = makeRow({ attempts: 4 });
      const {
        worker,
        markFailedRetryableMock,
        markFailedPermanentMock,
        updateHcmSyncStatusMock,
      } = buildWorker({
        dueRows: [row],
        hcmResult: { kind: 'transient', reason: 'HCM 500' },
      });

      await worker.tick();

      expect(markFailedRetryableMock).not.toHaveBeenCalled();
      expect(markFailedPermanentMock).toHaveBeenCalledTimes(1);
      expect(markFailedPermanentMock.mock.calls[0][1]).toMatch(
        /exhausted after 5 attempts/,
      );
      expect(updateHcmSyncStatusMock).toHaveBeenCalledWith(
        row.requestId,
        'failed',
        expect.anything(),
      );
    });
  });

  it('flips hcmSyncStatus to "failed" on a permanent HCM rejection', async () => {
    const row = makeRow();
    const {
      worker,
      markFailedPermanentMock,
      markFailedRetryableMock,
      updateHcmSyncStatusMock,
    } = buildWorker({
      dueRows: [row],
      hcmResult: {
        kind: 'permanent',
        status: 409,
        body: { code: 'insufficient_balance' },
      },
    });

    await worker.tick();

    expect(markFailedPermanentMock).toHaveBeenCalledTimes(1);
    expect(markFailedPermanentMock.mock.calls[0][1]).toMatch(/status=409/);
    expect(markFailedRetryableMock).not.toHaveBeenCalled();
    expect(updateHcmSyncStatusMock).toHaveBeenCalledWith(
      row.requestId,
      'failed',
      expect.anything(),
    );
  });

  it('marks a poison-payload row failed_permanent and continues past it instead of crashing the tick', async () => {
    const poison = makeRow({
      id: 'outbox-poison',
      requestId: 'req-poison',
      idempotencyKey: 'idem-poison',
      payloadJson: '{this is not valid JSON',
    });
    const healthy = makeRow({
      id: 'outbox-healthy',
      requestId: 'req-healthy',
      idempotencyKey: 'idem-healthy',
    });
    const {
      worker,
      postMutationMock,
      markFailedPermanentMock,
      updateHcmSyncStatusMock,
    } = buildWorker({ dueRows: [poison, healthy] });

    await worker.tick();

    // Poison row: no HCM call, marked failed_permanent with a parse
    // reason, request flips to 'failed'.
    expect(markFailedPermanentMock).toHaveBeenCalledTimes(1);
    const [markId, markReason] = markFailedPermanentMock.mock.calls[0];
    expect(markId).toBe(poison.id);
    expect(markReason).toMatch(/poison payload/i);
    expect(updateHcmSyncStatusMock).toHaveBeenCalledWith(
      poison.requestId,
      'failed',
      expect.anything(),
    );
    // Healthy row still gets pushed in the same tick — one bad row
    // does not starve the batch.
    expect(postMutationMock).toHaveBeenCalledTimes(1);
    expect(postMutationMock.mock.calls[0][0].idempotencyKey).toBe(
      'idem-healthy',
    );
  });

  it('processes due rows in the order returned by claimDueBatch', async () => {
    const older = makeRow({
      id: 'outbox-older',
      requestId: 'req-older',
      idempotencyKey: 'idem-older',
      nextAttemptAt: '2026-04-24T00:00:00.000Z',
    });
    const newer = makeRow({
      id: 'outbox-newer',
      requestId: 'req-newer',
      idempotencyKey: 'idem-newer',
      nextAttemptAt: '2026-04-24T00:00:10.000Z',
    });
    const { worker, postMutationMock } = buildWorker({
      dueRows: [older, newer],
    });

    await worker.tick();

    expect(postMutationMock).toHaveBeenCalledTimes(2);
    expect(postMutationMock.mock.calls[0][0].idempotencyKey).toBe('idem-older');
    expect(postMutationMock.mock.calls[1][0].idempotencyKey).toBe('idem-newer');
  });
});
