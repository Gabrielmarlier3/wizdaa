import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { Db } from '../database/connection';
import {
  createPendingRequest,
  TimeOffRequest,
} from '../domain/request';
import { hasSufficientBalance } from '../domain/balance';
import { BalancesRepository } from './repositories/balances.repository';
import { HoldsRepository } from './repositories/holds.repository';
import { RequestsRepository } from './repositories/requests.repository';

export class InvalidDimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDimensionError';
  }
}

export class InsufficientBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

export interface CreateRequestCommand {
  employeeId: string;
  locationId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  clientRequestId: string;
}

@Injectable()
export class CreateRequestUseCase {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly requestsRepo: RequestsRepository,
    private readonly balancesRepo: BalancesRepository,
    private readonly holdsRepo: HoldsRepository,
  ) {}

  execute(cmd: CreateRequestCommand): TimeOffRequest {
    // Client-UUID idempotency (TRD §9 *Dual idempotency*). Lookup is
    // outside the transaction because it is a read; a duplicate POST
    // returns the same entity without re-running the balance check.
    const existing = this.requestsRepo.findByClientRequestId(
      cmd.clientRequestId,
    );
    if (existing) {
      return existing;
    }

    const balance = this.balancesRepo.findByDimension(
      cmd.employeeId,
      cmd.locationId,
      cmd.leaveType,
    );
    if (!balance) {
      throw new InvalidDimensionError(
        `No balance record for (${cmd.employeeId}, ${cmd.locationId}, ${cmd.leaveType})`,
      );
    }

    const pendingDays = this.holdsRepo.sumActiveHoldDaysForDimension(
      cmd.employeeId,
      cmd.locationId,
      cmd.leaveType,
    );
    // Approved-not-yet-pushed overlay lands with the approve slice.
    const approvedNotYetPushedDays = 0;

    const sufficient = hasSufficientBalance(
      {
        hcmBalance: balance.hcmBalance,
        pendingDays,
        approvedNotYetPushedDays,
      },
      cmd.days,
    );
    if (!sufficient) {
      throw new InsufficientBalanceError(
        `Insufficient balance for (${cmd.employeeId}, ${cmd.locationId}, ${cmd.leaveType})`,
      );
    }

    const request = createPendingRequest({
      id: randomUUID(),
      employeeId: cmd.employeeId,
      locationId: cmd.locationId,
      leaveType: cmd.leaveType,
      startDate: cmd.startDate,
      endDate: cmd.endDate,
      days: cmd.days,
      clientRequestId: cmd.clientRequestId,
      now: new Date().toISOString(),
    });

    // Atomic insert — the request row and its hold row are either
    // both present or both absent (TRD §9 *Reserve balance at
    // creation as pending hold*).
    this.db.transaction((tx) => {
      this.requestsRepo.insert(request, tx);
      this.holdsRepo.insert(
        {
          id: randomUUID(),
          requestId: request.id,
          employeeId: request.employeeId,
          locationId: request.locationId,
          leaveType: request.leaveType,
          days: request.days,
        },
        tx,
      );
    });

    return request;
  }
}
