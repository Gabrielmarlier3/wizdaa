import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { Db } from '../database/connection';
import { ApprovedDeductionsRepository } from '../time-off/repositories/approved-deductions.repository';
import {
  BalanceDimension,
  BalancesRepository,
  BalanceUpsert,
} from '../time-off/repositories/balances.repository';
import { InconsistenciesRepository } from './repositories/inconsistencies.repository';

export interface BatchBalanceItem {
  employeeId: string;
  locationId: string;
  leaveType: string;
  balance: number;
}

export interface BatchBalancePayload {
  generatedAt: string;
  balances: BatchBalanceItem[];
}

export interface BatchBalanceResult {
  replaced: number;
  inconsistenciesDetected: number;
}

/**
 * HCM batch-intake ingress: replaces the full local balance
 * corpus with the incoming snapshot and flags any dimension
 * where `newHcmBalance − approvedNotYetPushed < 0` as an
 * inconsistency that halts further approvals (TRD §3.3 / §3.5 /
 * §9 decision 14).
 *
 * Policy decisions locked in plan 010:
 * - one transaction for the full batch (atomic-or-nothing).
 * - pending holds are deliberately excluded from the predicate
 *   — they self-heal on rejection/cancellation, so including
 *   them would false-positive whenever many pendings are open.
 * - auto-clear: a batch where the predicate no longer fires for
 *   a dimension deletes any existing inconsistency row for it.
 *   No manual-resolve endpoint.
 * - `generatedAt` is validated by the DTO but not persisted —
 *   nothing in scope uses it.
 */
@Injectable()
export class BatchBalanceIntakeUseCase {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly balancesRepo: BalancesRepository,
    private readonly approvedDeductionsRepo: ApprovedDeductionsRepository,
    private readonly inconsistenciesRepo: InconsistenciesRepository,
  ) {}

  async execute(payload: BatchBalancePayload): Promise<BatchBalanceResult> {
    const nowIso = new Date().toISOString();
    const rows: BalanceUpsert[] = payload.balances.map((item) => ({
      employeeId: item.employeeId,
      locationId: item.locationId,
      leaveType: item.leaveType,
      hcmBalance: item.balance,
      updatedAt: nowIso,
    }));
    const dimensions: BalanceDimension[] = payload.balances.map((item) => ({
      employeeId: item.employeeId,
      locationId: item.locationId,
      leaveType: item.leaveType,
    }));

    return this.db.transaction((tx): BatchBalanceResult => {
      this.balancesRepo.upsertBatch(rows, tx);
      this.balancesRepo.deleteNotInSet(dimensions, tx);

      let inconsistenciesDetected = 0;
      for (const item of payload.balances) {
        const approvedNotYetPushed =
          this.approvedDeductionsRepo.sumNotYetPushedDaysForDimension(
            item.employeeId,
            item.locationId,
            item.leaveType,
            tx,
          );
        const predicateFired = item.balance - approvedNotYetPushed < 0;
        if (predicateFired) {
          this.inconsistenciesRepo.upsert(
            item.employeeId,
            item.locationId,
            item.leaveType,
            nowIso,
            tx,
          );
          inconsistenciesDetected += 1;
        } else {
          this.inconsistenciesRepo.deleteByDimension(
            item.employeeId,
            item.locationId,
            item.leaveType,
            tx,
          );
        }
      }

      return {
        replaced: rows.length,
        inconsistenciesDetected,
      };
    });
  }
}
