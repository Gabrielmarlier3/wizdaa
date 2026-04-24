import {
  Body,
  ConflictException,
  Controller,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CreateRequestUseCase,
  InsufficientBalanceError,
  InvalidDimensionError,
} from './create-request.use-case';
import { CreateRequestDto } from './dto/create-request.dto';
import { TimeOffRequest } from '../domain/request';

@Controller('requests')
export class TimeOffController {
  constructor(private readonly createRequest: CreateRequestUseCase) {}

  @Post()
  create(@Body() dto: CreateRequestDto): TimeOffRequest {
    try {
      return this.createRequest.execute(dto);
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        throw new ConflictException({
          code: 'INSUFFICIENT_BALANCE',
          message: err.message,
        });
      }
      if (err instanceof InvalidDimensionError) {
        throw new UnprocessableEntityException({
          code: 'INVALID_DIMENSION',
          message: err.message,
        });
      }
      throw err;
    }
  }
}
