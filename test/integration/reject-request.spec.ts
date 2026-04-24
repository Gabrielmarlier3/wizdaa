import { eq } from 'drizzle-orm';
import {
  balances,
  holds,
  requests,
} from '../../src/database/schema';
import { CreateRequestUseCase } from '../../src/time-off/create-request.use-case';
import {
  RejectRequestUseCase,
} from '../../src/time-off/reject-request.use-case';
import { InvalidTransitionError } from '../../src/domain/request';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('RejectRequestUseCase (integration)', () => {
  let ctx: TestContext;
  let createRequest: CreateRequestUseCase;
  let rejectRequest: RejectRequestUseCase;

  beforeEach(async () => {
    ctx = await buildTestApp();
    createRequest = ctx.app.get(CreateRequestUseCase);
    rejectRequest = ctx.app.get(RejectRequestUseCase);
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

  it('serialises concurrent rejections so exactly one wins', async () => {
    seedBalance('emp-reject-concurrent', 'loc-BR', 'PTO', 10);

    const pending = createRequest.execute({
      employeeId: 'emp-reject-concurrent',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
      clientRequestId: 'client-reject-concurrent-01',
    });
    expect(pending.status).toBe('pending');

    // Two parallel rejections of the same pending id. The reject
    // use case is synchronous (no HCM call) so better-sqlite3
    // serialises the transactions; the UPDATE ... WHERE
    // status='pending' fence decides the winner.
    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        rejectRequest.execute({ requestId: pending.id }),
      ),
      Promise.resolve().then(() =>
        rejectRequest.execute({ requestId: pending.id }),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const failure = rejected[0] as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(InvalidTransitionError);
    const ite = failure.reason as InvalidTransitionError;
    expect(ite.to).toBe('rejected');
    expect(ite.from).toBe('rejected');

    // Terminal state: request is rejected; hold is gone.
    const reqRow = ctx.db
      .select()
      .from(requests)
      .where(eq(requests.id, pending.id))
      .get();
    expect(reqRow?.status).toBe('rejected');
    expect(reqRow?.hcmSyncStatus).toBe('not_required');

    const holdRow = ctx.db
      .select()
      .from(holds)
      .where(eq(holds.requestId, pending.id))
      .get();
    expect(holdRow).toBeUndefined();
  });
});
