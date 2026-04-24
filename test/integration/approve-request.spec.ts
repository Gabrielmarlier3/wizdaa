import { eq } from 'drizzle-orm';
import {
  approvedDeductions,
  balances,
  hcmOutbox,
  holds,
  requests,
} from '../../src/database/schema';
import {
  CreateRequestUseCase,
  InsufficientBalanceError,
  InvalidDimensionError,
} from '../../src/time-off/create-request.use-case';
import { ApproveRequestUseCase } from '../../src/time-off/approve-request.use-case';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('ApproveRequestUseCase (integration)', () => {
  let ctx: TestContext;
  let createRequest: CreateRequestUseCase;
  let approveRequest: ApproveRequestUseCase;

  beforeEach(async () => {
    ctx = await buildTestApp();
    createRequest = ctx.app.get(CreateRequestUseCase);
    approveRequest = ctx.app.get(ApproveRequestUseCase);
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

  it('rejects approval with InsufficientBalanceError when HCM balance shrank between creation and approval', async () => {
    seedBalance('emp-recheck', 'loc-BR', 'PTO', 10);

    const pending = createRequest.execute({
      employeeId: 'emp-recheck',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-03',
      days: 3,
      clientRequestId: 'client-recheck-01',
    });
    expect(pending.status).toBe('pending');

    // Simulate a batch sync shrinking the HCM value — the deferred
    // batch intake slice will do this via its own endpoint; here we
    // mutate directly to isolate the re-check behaviour.
    ctx.db
      .update(balances)
      .set({ hcmBalance: 2 })
      .where(eq(balances.employeeId, 'emp-recheck'))
      .run();

    await expect(
      approveRequest.execute({ requestId: pending.id }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);

    // Post-state: the rolled-back transaction leaves the pending
    // request, its hold, and no approved-deduction / outbox rows.
    const reqRow = ctx.db
      .select()
      .from(requests)
      .where(eq(requests.id, pending.id))
      .get();
    expect(reqRow?.status).toBe('pending');
    expect(reqRow?.hcmSyncStatus).toBe('not_required');

    const holdRow = ctx.db
      .select()
      .from(holds)
      .where(eq(holds.requestId, pending.id))
      .get();
    expect(holdRow).toBeDefined();

    const dedRow = ctx.db
      .select()
      .from(approvedDeductions)
      .where(eq(approvedDeductions.requestId, pending.id))
      .get();
    expect(dedRow).toBeUndefined();

    const outboxRow = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.requestId, pending.id))
      .get();
    expect(outboxRow).toBeUndefined();
  });

  it('throws InvalidDimensionError when the balance row disappeared between creation and approval', async () => {
    seedBalance('emp-missing-dim', 'loc-BR', 'PTO', 10);

    const pending = createRequest.execute({
      employeeId: 'emp-missing-dim',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
      clientRequestId: 'client-missing-dim-01',
    });
    expect(pending.status).toBe('pending');

    // Simulate a batch sync dropping the dimension entirely between
    // creation and approval.
    ctx.db
      .delete(balances)
      .where(eq(balances.employeeId, 'emp-missing-dim'))
      .run();

    await expect(
      approveRequest.execute({ requestId: pending.id }),
    ).rejects.toBeInstanceOf(InvalidDimensionError);

    // Rollback: request pending, hold intact, no ledger / outbox
    // side effects.
    const reqRow = ctx.db
      .select()
      .from(requests)
      .where(eq(requests.id, pending.id))
      .get();
    expect(reqRow?.status).toBe('pending');
    expect(reqRow?.hcmSyncStatus).toBe('not_required');

    const holdRow = ctx.db
      .select()
      .from(holds)
      .where(eq(holds.requestId, pending.id))
      .get();
    expect(holdRow).toBeDefined();

    const dedRow = ctx.db
      .select()
      .from(approvedDeductions)
      .where(eq(approvedDeductions.requestId, pending.id))
      .get();
    expect(dedRow).toBeUndefined();

    const outboxRow = ctx.db
      .select()
      .from(hcmOutbox)
      .where(eq(hcmOutbox.requestId, pending.id))
      .get();
    expect(outboxRow).toBeUndefined();
  });
});
