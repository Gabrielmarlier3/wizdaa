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
} from '../../src/time-off/create-request.use-case';
import { ApproveRequestUseCase } from '../../src/time-off/approve-request.use-case';
import { buildTestApp, TestContext } from '../helpers/test-app';

/**
 * Plan 011 reviewer flagged that `create-request.use-case.ts`
 * had a `approvedNotYetPushedDays = 0` placeholder that should
 * have been replaced when the approve slice landed (TRD §9
 * *Approved deductions as a separate ledger table* impact
 * note). With the placeholder, an employee could file a
 * request that the approve re-check was guaranteed to reject:
 * false-positive UX and a §8.3 defence-rule slip.
 *
 * This spec pins the now-real query: a balance fully consumed
 * by an approved-not-yet-pushed deduction must reject a fresh
 * create against the same dimension.
 */
describe('CreateRequestUseCase (integration) — overlay enforcement', () => {
  let ctx: TestContext;
  let createRequest: CreateRequestUseCase;

  beforeEach(async () => {
    ctx = await buildTestApp();
    createRequest = ctx.app.get(CreateRequestUseCase);
  });

  afterEach(async () => {
    await ctx.close();
  });

  function seedBalance(hcmBalance: number): void {
    ctx.db
      .insert(balances)
      .values({
        employeeId: 'emp-overlay',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        hcmBalance,
        updatedAt: new Date().toISOString(),
      })
      .run();
  }

  it('rejects creation when approved-not-yet-pushed deductions already consume the balance', async () => {
    seedBalance(10);

    const approveRequest = ctx.app.get(ApproveRequestUseCase);

    const firstPending = createRequest.execute({
      employeeId: 'emp-overlay',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-08',
      days: 6,
      clientRequestId: 'client-overlay-1',
    });
    expect(firstPending.status).toBe('pending');

    // Approving inserts an approved_deductions row + an outbox row
    // whose status starts at 'pending' (the in-test mock HCM flips
    // it to 'synced' on the inline push, but the deduction-sum
    // query filters by outbox.status IN ('pending','failed_retryable').
    // To force the deduction to still count we leave the outbox in
    // the pre-resolution state by going through the use case and
    // then walking back the outbox row to 'pending' if the inline
    // push synced it.
    await approveRequest.execute({ requestId: firstPending.id });

    // Coerce outbox back to non-synced so the deduction stays in
    // the overlay sum — the realistic production scenario this
    // protects is "approve committed locally; HCM push hasn't
    // succeeded yet".
    ctx.db
      .update(hcmOutbox)
      .set({ status: 'pending' })
      .where(eq(hcmOutbox.requestId, firstPending.id))
      .run();
    ctx.db
      .update(requests)
      .set({ hcmSyncStatus: 'pending' })
      .where(eq(requests.id, firstPending.id))
      .run();

    expect(() =>
      createRequest.execute({
        employeeId: 'emp-overlay',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        startDate: '2026-06-01',
        endDate: '2026-06-08',
        days: 6,
        clientRequestId: 'client-overlay-2',
      }),
    ).toThrow(InsufficientBalanceError);

    // No second pending row, no second hold, no second outbox row.
    const allRequests = ctx.db
      .select()
      .from(requests)
      .all()
      .filter((r) => r.employeeId === 'emp-overlay');
    expect(allRequests).toHaveLength(1);

    const allHolds = ctx.db.select().from(holds).all();
    expect(allHolds).toHaveLength(0);

    const allDeductions = ctx.db.select().from(approvedDeductions).all();
    expect(allDeductions).toHaveLength(1);
  });

  it('still allows creation when the approved deduction has been synced (outbox no longer counts)', async () => {
    seedBalance(10);

    const approveRequest = ctx.app.get(ApproveRequestUseCase);

    const firstPending = createRequest.execute({
      employeeId: 'emp-overlay',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-04',
      days: 3,
      clientRequestId: 'client-overlay-synced-1',
    });
    await approveRequest.execute({ requestId: firstPending.id });

    // Inline push lands 'synced' under the default mock scenario;
    // the deduction-sum query filters synced rows out, so the
    // overlay no longer counts that 3 days. 10 − 0 (pending) −
    // 0 (approved-not-yet-pushed) = 10 ≥ 6 ⇒ create succeeds.
    const second = createRequest.execute({
      employeeId: 'emp-overlay',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-06-01',
      endDate: '2026-06-08',
      days: 6,
      clientRequestId: 'client-overlay-synced-2',
    });
    expect(second.status).toBe('pending');
  });
});
