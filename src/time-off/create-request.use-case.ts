import { randomUUID } from 'node:crypto';
import BetterSqlite3 from 'better-sqlite3';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { Db } from '../database/connection';
import { createPendingRequest, TimeOffRequest } from '../domain/request';
import { hasSufficientBalance } from '../domain/balance';
import { InsufficientBalanceError, InvalidDimensionError } from './errors';
import { ApprovedDeductionsRepository } from './repositories/approved-deductions.repository';
import { BalancesRepository } from './repositories/balances.repository';
import { HoldsRepository } from './repositories/holds.repository';
import { RequestsRepository } from './repositories/requests.repository';

export interface CreateRequestCommand {
  employeeId: string;
  locationId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  clientRequestId: string;
}

function isClientRequestIdDuplicate(err: unknown): boolean {
  return (
    err instanceof BetterSqlite3.SqliteError &&
    err.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    err.message.includes('requests.client_request_id')
  );
}

@Injectable()
export class CreateRequestUseCase {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly requestsRepo: RequestsRepository,
    private readonly balancesRepo: BalancesRepository,
    private readonly holdsRepo: HoldsRepository,
    private readonly approvedDeductionsRepo: ApprovedDeductionsRepository,
  ) {}

  execute(cmd: CreateRequestCommand): TimeOffRequest {
    // Read-validate-insert runs inside one transaction so the
    // balance projection is stable against concurrent writers and
    // the approve slice's HCM awaits cannot later break the check
    // silently (TRD §8.4 consistency, §9 *Reserve balance at
    // creation as pending hold*).
    return this.db.transaction((tx) => {
      const existing = this.requestsRepo.findByClientRequestId(
        cmd.clientRequestId,
        tx,
      );
      if (existing) {
        return existing;
      }

      const balance = this.balancesRepo.findByDimension(
        cmd.employeeId,
        cmd.locationId,
        cmd.leaveType,
        tx,
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
        tx,
      );
      // Already-approved deductions whose HCM push has not yet
      // succeeded still consume the local view of the balance
      // (TRD §3.4 overlay projection). Without this term the
      // create-time check would let an employee file a request
      // that the approve re-check is guaranteed to reject —
      // false positive UX, and a §8.3 defence-rule slip.
      const approvedNotYetPushedDays =
        this.approvedDeductionsRepo.sumNotYetPushedDaysForDimension(
          cmd.employeeId,
          cmd.locationId,
          cmd.leaveType,
          tx,
        );

      if (
        !hasSufficientBalance(
          {
            hcmBalance: balance.hcmBalance,
            pendingDays,
            approvedNotYetPushedDays,
          },
          cmd.days,
        )
      ) {
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

      try {
        this.requestsRepo.insert(request, tx);
      } catch (err) {
        // Cross-process race: another writer committed the same
        // clientRequestId between our read and our insert. The
        // UNIQUE constraint is the authoritative guard; recover by
        // reading the winning row and returning it idempotently.
        if (isClientRequestIdDuplicate(err)) {
          const stored = this.requestsRepo.findByClientRequestId(
            cmd.clientRequestId,
            tx,
          );
          if (stored) {
            return stored;
          }
        }
        throw err;
      }

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

      return request;
    });
  }
}
