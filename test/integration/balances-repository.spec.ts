import { balances } from '../../src/database/schema';
import {
  BalanceDimension,
  BalancesRepository,
  BalanceUpsert,
} from '../../src/time-off/repositories/balances.repository';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('BalancesRepository batch writes', () => {
  let ctx: TestContext;
  let repo: BalancesRepository;

  beforeEach(async () => {
    ctx = await buildTestApp();
    repo = ctx.app.get(BalancesRepository);
  });

  afterEach(async () => {
    await ctx.close();
  });

  const nowIso = '2026-04-24T12:00:00.000Z';

  function allBalances() {
    return ctx.db.select().from(balances).all();
  }

  function makeRow(overrides: Partial<BalanceUpsert> = {}): BalanceUpsert {
    return {
      employeeId: 'emp-1',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      hcmBalance: 10,
      updatedAt: nowIso,
      ...overrides,
    };
  }

  describe('upsertBatch', () => {
    it('inserts fresh rows', () => {
      repo.upsertBatch([
        makeRow({ employeeId: 'emp-1', hcmBalance: 10 }),
        makeRow({ employeeId: 'emp-2', hcmBalance: 20 }),
      ]);

      const rows = allBalances();
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ employeeId: 'emp-1', hcmBalance: 10 }),
          expect.objectContaining({ employeeId: 'emp-2', hcmBalance: 20 }),
        ]),
      );
    });

    it('replaces hcmBalance and updatedAt on conflict', () => {
      repo.upsertBatch([makeRow({ hcmBalance: 10, updatedAt: nowIso })]);
      const later = '2026-04-25T12:00:00.000Z';
      repo.upsertBatch([makeRow({ hcmBalance: 7, updatedAt: later })]);

      const rows = allBalances();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        employeeId: 'emp-1',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        hcmBalance: 7,
        updatedAt: later,
      });
    });

    it('is idempotent when called with the same input twice', () => {
      const batch = [
        makeRow({ employeeId: 'emp-1', hcmBalance: 10 }),
        makeRow({ employeeId: 'emp-2', hcmBalance: 20 }),
      ];
      repo.upsertBatch(batch);
      repo.upsertBatch(batch);

      const rows = allBalances();
      expect(rows).toHaveLength(2);
    });

    it('empty array is a no-op', () => {
      repo.upsertBatch([makeRow()]);
      expect(() => repo.upsertBatch([])).not.toThrow();
      expect(allBalances()).toHaveLength(1);
    });
  });

  describe('deleteNotInSet', () => {
    function seedFour(): void {
      repo.upsertBatch([
        makeRow({ employeeId: 'emp-1' }),
        makeRow({ employeeId: 'emp-2' }),
        makeRow({ employeeId: 'emp-3' }),
        makeRow({ employeeId: 'emp-4' }),
      ]);
    }

    function dims(...employeeIds: string[]): BalanceDimension[] {
      return employeeIds.map((employeeId) => ({
        employeeId,
        locationId: 'loc-BR',
        leaveType: 'PTO',
      }));
    }

    it('removes rows not present in the keep set', () => {
      seedFour();

      repo.deleteNotInSet(dims('emp-1', 'emp-3'));

      const rows = allBalances()
        .map((r) => r.employeeId)
        .sort();
      expect(rows).toEqual(['emp-1', 'emp-3']);
    });

    it('leaves all rows untouched when every row is in the keep set', () => {
      seedFour();

      repo.deleteNotInSet(dims('emp-1', 'emp-2', 'emp-3', 'emp-4'));

      expect(allBalances()).toHaveLength(4);
    });

    it('deletes every row when the keep set is empty', () => {
      seedFour();

      repo.deleteNotInSet([]);

      expect(allBalances()).toHaveLength(0);
    });

    it('discriminates by full composite key, not employeeId alone', () => {
      repo.upsertBatch([
        makeRow({ employeeId: 'emp-1', locationId: 'loc-BR' }),
        makeRow({ employeeId: 'emp-1', locationId: 'loc-US' }),
      ]);

      repo.deleteNotInSet([
        { employeeId: 'emp-1', locationId: 'loc-BR', leaveType: 'PTO' },
      ]);

      const rows = allBalances();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        employeeId: 'emp-1',
        locationId: 'loc-BR',
      });
    });

    it('is safe against delimiter-like characters in identifier fields', () => {
      // Adversarial but legal values: a naive `${a}|${b}|${c}`
      // encoding would collapse these two triples to the same
      // string and silently keep one of them.
      repo.upsertBatch([
        makeRow({ employeeId: 'emp|loc', locationId: 'BR', leaveType: 'PTO' }),
        makeRow({ employeeId: 'emp', locationId: 'loc|BR', leaveType: 'PTO' }),
      ]);

      repo.deleteNotInSet([
        { employeeId: 'emp|loc', locationId: 'BR', leaveType: 'PTO' },
      ]);

      const rows = allBalances();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        employeeId: 'emp|loc',
        locationId: 'BR',
      });
    });
  });

  it('upsertBatch + deleteNotInSet together reproduce full-corpus replacement', () => {
    repo.upsertBatch([
      makeRow({ employeeId: 'emp-old-1', hcmBalance: 5 }),
      makeRow({ employeeId: 'emp-old-2', hcmBalance: 5 }),
    ]);

    const incoming = [
      makeRow({ employeeId: 'emp-new', hcmBalance: 8 }),
      makeRow({ employeeId: 'emp-old-1', hcmBalance: 3 }),
    ];
    repo.upsertBatch(incoming);
    repo.deleteNotInSet(
      incoming.map((r) => ({
        employeeId: r.employeeId,
        locationId: r.locationId,
        leaveType: r.leaveType,
      })),
    );

    const rows = allBalances().sort((a, b) =>
      a.employeeId.localeCompare(b.employeeId),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ employeeId: 'emp-new', hcmBalance: 8 });
    expect(rows[1]).toMatchObject({ employeeId: 'emp-old-1', hcmBalance: 3 });
  });
});
