import { eq, and } from 'drizzle-orm';
import { inconsistencies } from '../../src/database/schema';
import { InconsistenciesRepository } from '../../src/hcm/repositories/inconsistencies.repository';
import { buildTestApp, TestContext } from '../helpers/test-app';

describe('InconsistenciesRepository', () => {
  let ctx: TestContext;
  let repo: InconsistenciesRepository;

  beforeEach(async () => {
    ctx = await buildTestApp();
    repo = ctx.app.get(InconsistenciesRepository);
  });

  afterEach(async () => {
    await ctx.close();
  });

  const dim = {
    employeeId: 'emp-1',
    locationId: 'loc-BR',
    leaveType: 'PTO',
  } as const;

  function rowOnDb() {
    return ctx.db
      .select()
      .from(inconsistencies)
      .where(
        and(
          eq(inconsistencies.employeeId, dim.employeeId),
          eq(inconsistencies.locationId, dim.locationId),
          eq(inconsistencies.leaveType, dim.leaveType),
        ),
      )
      .get();
  }

  it('findByDimension returns undefined when no row exists', () => {
    expect(
      repo.findByDimension(dim.employeeId, dim.locationId, dim.leaveType),
    ).toBeUndefined();
  });

  it('upsert inserts a fresh row with detected_at = updated_at = now', () => {
    const now = '2026-04-24T12:00:00.000Z';
    repo.upsert(dim.employeeId, dim.locationId, dim.leaveType, now);

    const row = repo.findByDimension(
      dim.employeeId,
      dim.locationId,
      dim.leaveType,
    );
    expect(row).toEqual({
      ...dim,
      detectedAt: now,
      updatedAt: now,
    });
  });

  it('upsert on an existing row advances updated_at but preserves detected_at', () => {
    const first = '2026-04-24T12:00:00.000Z';
    const second = '2026-04-24T18:00:00.000Z';
    repo.upsert(dim.employeeId, dim.locationId, dim.leaveType, first);
    repo.upsert(dim.employeeId, dim.locationId, dim.leaveType, second);

    const row = repo.findByDimension(
      dim.employeeId,
      dim.locationId,
      dim.leaveType,
    );
    expect(row?.detectedAt).toBe(first);
    expect(row?.updatedAt).toBe(second);
  });

  it('deleteByDimension removes the row when present', () => {
    const now = '2026-04-24T12:00:00.000Z';
    repo.upsert(dim.employeeId, dim.locationId, dim.leaveType, now);
    expect(rowOnDb()).toBeDefined();

    repo.deleteByDimension(dim.employeeId, dim.locationId, dim.leaveType);

    expect(rowOnDb()).toBeUndefined();
  });

  it('deleteByDimension is a no-op when no row exists', () => {
    expect(() =>
      repo.deleteByDimension(dim.employeeId, dim.locationId, dim.leaveType),
    ).not.toThrow();
    expect(rowOnDb()).toBeUndefined();
  });

  it('rows for different dimensions are independent', () => {
    const now = '2026-04-24T12:00:00.000Z';
    repo.upsert('emp-1', 'loc-BR', 'PTO', now);
    repo.upsert('emp-2', 'loc-BR', 'PTO', now);

    repo.deleteByDimension('emp-1', 'loc-BR', 'PTO');

    expect(repo.findByDimension('emp-1', 'loc-BR', 'PTO')).toBeUndefined();
    expect(repo.findByDimension('emp-2', 'loc-BR', 'PTO')).toBeDefined();
  });

  describe('deleteNotInSet', () => {
    const now = '2026-04-24T12:00:00.000Z';

    it('removes rows whose composite key is absent from keep', () => {
      repo.upsert('emp-1', 'loc-BR', 'PTO', now);
      repo.upsert('emp-2', 'loc-BR', 'PTO', now);
      repo.upsert('emp-3', 'loc-BR', 'PTO', now);

      repo.deleteNotInSet([
        { employeeId: 'emp-1', locationId: 'loc-BR', leaveType: 'PTO' },
      ]);

      expect(repo.findByDimension('emp-1', 'loc-BR', 'PTO')).toBeDefined();
      expect(repo.findByDimension('emp-2', 'loc-BR', 'PTO')).toBeUndefined();
      expect(repo.findByDimension('emp-3', 'loc-BR', 'PTO')).toBeUndefined();
    });

    it('discriminates by full composite key', () => {
      repo.upsert('emp-1', 'loc-BR', 'PTO', now);
      repo.upsert('emp-1', 'loc-US', 'PTO', now);

      repo.deleteNotInSet([
        { employeeId: 'emp-1', locationId: 'loc-BR', leaveType: 'PTO' },
      ]);

      expect(repo.findByDimension('emp-1', 'loc-BR', 'PTO')).toBeDefined();
      expect(repo.findByDimension('emp-1', 'loc-US', 'PTO')).toBeUndefined();
    });

    it('empty keep-set removes every row', () => {
      repo.upsert('emp-1', 'loc-BR', 'PTO', now);
      repo.upsert('emp-2', 'loc-BR', 'PTO', now);

      repo.deleteNotInSet([]);

      expect(repo.findByDimension('emp-1', 'loc-BR', 'PTO')).toBeUndefined();
      expect(repo.findByDimension('emp-2', 'loc-BR', 'PTO')).toBeUndefined();
    });
  });
});
