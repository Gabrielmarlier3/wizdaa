import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  approvedDeductions,
  balances,
  hcmOutbox,
  inconsistencies,
  requests,
} from '../../src/database/schema';
import { BatchBalanceIntakeUseCase } from '../../src/hcm/batch-balance-intake.use-case';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('BatchBalanceIntakeUseCase (integration)', () => {
  let ctx: TestContext;
  let useCase: BatchBalanceIntakeUseCase;

  beforeEach(async () => {
    ctx = await buildTestApp();
    useCase = ctx.app.get(BatchBalanceIntakeUseCase);
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

  /**
   * Seeds one approved_deductions row + its hcm_outbox row in a
   * non-synced state so that
   * `sumNotYetPushedDaysForDimension` counts it.
   */
  function seedApprovedDeduction(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): void {
    const requestId = randomUUID();
    ctx.db
      .insert(requests)
      .values({
        id: requestId,
        employeeId,
        locationId,
        leaveType,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days,
        status: 'approved',
        hcmSyncStatus: 'pending',
        clientRequestId: `client-${requestId}`,
        createdAt: new Date().toISOString(),
      })
      .run();
    ctx.db
      .insert(approvedDeductions)
      .values({
        id: randomUUID(),
        requestId,
        employeeId,
        locationId,
        leaveType,
        days,
        createdAt: new Date().toISOString(),
      })
      .run();
    ctx.db
      .insert(hcmOutbox)
      .values({
        id: randomUUID(),
        requestId,
        idempotencyKey: randomUUID(),
        payloadJson: '{}',
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  function allBalances() {
    return ctx.db
      .select()
      .from(balances)
      .all()
      .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  }

  function inconsistencyFor(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ) {
    return ctx.db
      .select()
      .from(inconsistencies)
      .where(
        and(
          eq(inconsistencies.employeeId, employeeId),
          eq(inconsistencies.locationId, locationId),
          eq(inconsistencies.leaveType, leaveType),
        ),
      )
      .get();
  }

  it('replaces the balance corpus — upserts incoming dimensions and deletes the rest', async () => {
    seedBalance('emp-1', 'loc-BR', 'PTO', 10);
    seedBalance('emp-2', 'loc-BR', 'PTO', 20);
    seedBalance('emp-3', 'loc-BR', 'PTO', 30);

    const result = await useCase.execute({
      generatedAt: '2026-04-24T12:00:00.000Z',
      balances: [
        {
          employeeId: 'emp-1',
          locationId: 'loc-BR',
          leaveType: 'PTO',
          balance: 8,
        },
        {
          employeeId: 'emp-2',
          locationId: 'loc-BR',
          leaveType: 'PTO',
          balance: 25,
        },
      ],
    });

    expect(result).toEqual({ replaced: 2, inconsistenciesDetected: 0 });

    const rows = allBalances();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ employeeId: 'emp-1', hcmBalance: 8 });
    expect(rows[1]).toMatchObject({ employeeId: 'emp-2', hcmBalance: 25 });
  });

  it('flags a dimension whose new HCM balance is lower than approved-not-yet-pushed', async () => {
    seedBalance('emp-1', 'loc-BR', 'PTO', 10);
    seedApprovedDeduction('emp-1', 'loc-BR', 'PTO', 6);

    const result = await useCase.execute({
      generatedAt: '2026-04-24T12:00:00.000Z',
      balances: [
        {
          employeeId: 'emp-1',
          locationId: 'loc-BR',
          leaveType: 'PTO',
          balance: 4,
        },
      ],
    });

    // 4 (new HCM) − 6 (approved not yet pushed) = −2 < 0 → flag.
    expect(result.inconsistenciesDetected).toBe(1);
    expect(inconsistencyFor('emp-1', 'loc-BR', 'PTO')).toBeDefined();
  });

  it('auto-clears an existing inconsistency row when the next batch no longer triggers the predicate', async () => {
    seedBalance('emp-1', 'loc-BR', 'PTO', 10);
    seedApprovedDeduction('emp-1', 'loc-BR', 'PTO', 6);
    ctx.db
      .insert(inconsistencies)
      .values({
        employeeId: 'emp-1',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        detectedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
      })
      .run();

    const result = await useCase.execute({
      generatedAt: '2026-04-24T12:00:00.000Z',
      balances: [
        // 10 − 6 = 4 >= 0, predicate does NOT fire → auto-clear.
        {
          employeeId: 'emp-1',
          locationId: 'loc-BR',
          leaveType: 'PTO',
          balance: 10,
        },
      ],
    });

    expect(result.inconsistenciesDetected).toBe(0);
    expect(inconsistencyFor('emp-1', 'loc-BR', 'PTO')).toBeUndefined();
  });

  it('sweeps ghost inconsistency rows when a dimension is dropped from the corpus', async () => {
    // Seed a balance + inconsistency for a dimension that will
    // NOT appear in the incoming batch.
    seedBalance('emp-ghost', 'loc-BR', 'PTO', 10);
    ctx.db
      .insert(inconsistencies)
      .values({
        employeeId: 'emp-ghost',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        detectedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
      })
      .run();

    // Batch contains a different dimension; emp-ghost gets dropped
    // from balances by deleteNotInSet and must also lose its flag.
    await useCase.execute({
      generatedAt: '2026-04-24T12:00:00.000Z',
      balances: [
        {
          employeeId: 'emp-new',
          locationId: 'loc-BR',
          leaveType: 'PTO',
          balance: 5,
        },
      ],
    });

    expect(inconsistencyFor('emp-ghost', 'loc-BR', 'PTO')).toBeUndefined();
  });

  it('is idempotent when the same batch is replayed', async () => {
    seedBalance('emp-1', 'loc-BR', 'PTO', 10);
    seedApprovedDeduction('emp-1', 'loc-BR', 'PTO', 6);

    const input = {
      generatedAt: '2026-04-24T12:00:00.000Z',
      balances: [
        {
          employeeId: 'emp-1',
          locationId: 'loc-BR',
          leaveType: 'PTO',
          balance: 4,
        },
      ],
    };
    await useCase.execute(input);
    const second = await useCase.execute(input);

    expect(second.inconsistenciesDetected).toBe(1);
    expect(allBalances()).toHaveLength(1);
    expect(allBalances()[0].hcmBalance).toBe(4);
    // The same row remains — no duplicate inconsistencies, just
    // updated_at advances on the second run.
    expect(inconsistencyFor('emp-1', 'loc-BR', 'PTO')).toBeDefined();
  });
});
