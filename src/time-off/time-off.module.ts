import { Module } from '@nestjs/common';
import { CreateRequestUseCase } from './create-request.use-case';
import { BalancesRepository } from './repositories/balances.repository';
import { HoldsRepository } from './repositories/holds.repository';
import { RequestsRepository } from './repositories/requests.repository';
import { TimeOffController } from './time-off.controller';

@Module({
  controllers: [TimeOffController],
  providers: [
    CreateRequestUseCase,
    RequestsRepository,
    HoldsRepository,
    BalancesRepository,
  ],
})
export class TimeOffModule {}
