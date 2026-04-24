import { Injectable } from '@nestjs/common';
import { availableBalance } from '../domain/balance';
import { ApprovedDeductionsRepository } from '../time-off/repositories/approved-deductions.repository';
import { BalancesRepository } from '../time-off/repositories/balances.repository';
import { HoldsRepository } from '../time-off/repositories/holds.repository';
import { BalanceNotFoundError } from './errors';

export interface GetBalanceQuery {
  employeeId: string;
  locationId: string;
  leaveType: string;
}

export interface BalanceProjection {
  employeeId: string;
  locationId: string;
  leaveType: string;
  hcmBalance: number;
  pendingDays: number;
  approvedNotYetPushedDays: number;
  availableDays: number;
}

/**
 * Read-side projection for the balance of one dimension (TRD §3.4).
 * Composes the three overlay sources — HCM raw balance, pending
 * reservations, approved-not-yet-pushed deductions — into the
 * breakdown clients reconcile against after a 409.
 */
@Injectable()
export class GetBalanceUseCase {
  constructor(
    private readonly balancesRepo: BalancesRepository,
    private readonly holdsRepo: HoldsRepository,
    private readonly approvedDeductionsRepo: ApprovedDeductionsRepository,
  ) {}

  execute(query: GetBalanceQuery): BalanceProjection {
    const balance = this.balancesRepo.findByDimension(
      query.employeeId,
      query.locationId,
      query.leaveType,
    );
    if (!balance) {
      throw new BalanceNotFoundError(
        query.employeeId,
        query.locationId,
        query.leaveType,
      );
    }

    const pendingDays = this.holdsRepo.sumActiveHoldDaysForDimension(
      query.employeeId,
      query.locationId,
      query.leaveType,
    );
    const approvedNotYetPushedDays =
      this.approvedDeductionsRepo.sumNotYetPushedDaysForDimension(
        query.employeeId,
        query.locationId,
        query.leaveType,
      );

    const availableDays = availableBalance({
      hcmBalance: balance.hcmBalance,
      pendingDays,
      approvedNotYetPushedDays,
    });

    return {
      employeeId: query.employeeId,
      locationId: query.locationId,
      leaveType: query.leaveType,
      hcmBalance: balance.hcmBalance,
      pendingDays,
      approvedNotYetPushedDays,
      availableDays,
    };
  }
}
