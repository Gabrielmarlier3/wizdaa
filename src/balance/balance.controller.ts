import {
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { GetBalanceQueryDto } from './dto/get-balance-query.dto';
import { BalanceNotFoundError } from './errors';
import {
  BalanceProjection,
  GetBalanceUseCase,
} from './get-balance.use-case';

@Controller('balance')
export class BalanceController {
  constructor(private readonly getBalance: GetBalanceUseCase) {}

  @Get()
  get(@Query() query: GetBalanceQueryDto): BalanceProjection {
    try {
      return this.getBalance.execute(query);
    } catch (err) {
      if (err instanceof BalanceNotFoundError) {
        throw new NotFoundException({
          code: 'BALANCE_NOT_FOUND',
          message: err.message,
        });
      }
      throw err;
    }
  }
}
