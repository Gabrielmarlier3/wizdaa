import { Db } from '../database/connection';
import { HcmOutboxRepository } from '../time-off/repositories/hcm-outbox.repository';
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
});
