import { eq } from 'drizzle-orm';
import { balances, holds, requests } from '../../src/database/schema';
import { CreateRequestUseCase } from '../../src/time-off/create-request.use-case';
import { CancelRequestUseCase } from '../../src/time-off/cancel-request.use-case';
import { InvalidTransitionError } from '../../src/domain/request';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('CancelRequestUseCase (integration)', () => {
  let ctx: TestContext;
  let createRequest: CreateRequestUseCase;
  let cancelRequest: CancelRequestUseCase;

  beforeEach(async () => {
    ctx = await buildTestApp();
    createRequest = ctx.app.get(CreateRequestUseCase);
    cancelRequest = ctx.app.get(CancelRequestUseCase);
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

  it('serialises concurrent cancellations so exactly one wins', async () => {
    seedBalance('emp-cancel-concurrent', 'loc-BR', 'PTO', 10);

    const pending = createRequest.execute({
      employeeId: 'emp-cancel-concurrent',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
      clientRequestId: 'client-cancel-concurrent-01',
    });
    expect(pending.status).toBe('pending');

    // Two parallel cancellations of the same pending id. better-
    // sqlite3 serialises the transactions; the guarded UPDATE ...
    // WHERE status='pending' fence decides the winner.
    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        cancelRequest.execute({ requestId: pending.id }),
      ),
      Promise.resolve().then(() =>
        cancelRequest.execute({ requestId: pending.id }),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const failure = rejected[0] as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(InvalidTransitionError);
    const ite = failure.reason as InvalidTransitionError;
    expect(ite.to).toBe('cancelled');
    expect(ite.from).toBe('cancelled');

    // Terminal state: request is cancelled; hold is gone.
    const reqRow = ctx.db
      .select()
      .from(requests)
      .where(eq(requests.id, pending.id))
      .get();
    expect(reqRow?.status).toBe('cancelled');
    expect(reqRow?.hcmSyncStatus).toBe('not_required');

    const holdRow = ctx.db
      .select()
      .from(holds)
      .where(eq(holds.requestId, pending.id))
      .get();
    expect(holdRow).toBeUndefined();
  });
});
