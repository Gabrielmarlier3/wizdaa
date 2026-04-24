import { Injectable } from '@nestjs/common';
import { TimeOffRequest } from '../domain/request';
import { RequestNotFoundError } from './errors';
import { RequestsRepository } from './repositories/requests.repository';

export interface GetRequestQuery {
  requestId: string;
}

/**
 * Read a single request by id. Thin wrapper around the repository
 * lookup that centralises the "absent ⇒ domain error" decision —
 * controllers stay one-liners (TRD §2, INSTRUCTIONS.md §12).
 */
@Injectable()
export class GetRequestUseCase {
  constructor(private readonly requestsRepo: RequestsRepository) {}

  execute(query: GetRequestQuery): TimeOffRequest {
    const row = this.requestsRepo.findById(query.requestId);
    if (!row) {
      throw new RequestNotFoundError(query.requestId);
    }
    return row;
  }
}
