import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InvalidTransitionError, TimeOffRequest } from '../domain/request';
import { ApproveRequestUseCase } from './approve-request.use-case';
import { CancelRequestUseCase } from './cancel-request.use-case';
import { CreateRequestUseCase } from './create-request.use-case';
import { CreateRequestDto } from './dto/create-request.dto';
import {
  DimensionInconsistentError,
  InsufficientBalanceError,
  InvalidDimensionError,
  RequestNotFoundError,
} from './errors';
import { GetRequestUseCase } from './get-request.use-case';
import { RejectRequestUseCase } from './reject-request.use-case';

@Controller('requests')
export class TimeOffController {
  constructor(
    private readonly createRequest: CreateRequestUseCase,
    private readonly approveRequest: ApproveRequestUseCase,
    private readonly rejectRequest: RejectRequestUseCase,
    private readonly cancelRequest: CancelRequestUseCase,
    private readonly getRequest: GetRequestUseCase,
  ) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): TimeOffRequest {
    try {
      return this.getRequest.execute({ requestId: id });
    } catch (err) {
      if (err instanceof RequestNotFoundError) {
        throw new NotFoundException({
          code: 'REQUEST_NOT_FOUND',
          message: err.message,
        });
      }
      throw err;
    }
  }

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

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TimeOffRequest> {
    try {
      return await this.approveRequest.execute({ requestId: id });
    } catch (err) {
      if (err instanceof RequestNotFoundError) {
        throw new NotFoundException({
          code: 'REQUEST_NOT_FOUND',
          message: err.message,
        });
      }
      if (err instanceof InvalidTransitionError) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: err.message,
          currentStatus: err.from,
        });
      }
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
      if (err instanceof DimensionInconsistentError) {
        throw new ConflictException({
          code: 'DIMENSION_INCONSISTENT',
          message: err.message,
          employeeId: err.employeeId,
          locationId: err.locationId,
          leaveType: err.leaveType,
        });
      }
      throw err;
    }
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseUUIDPipe) id: string): TimeOffRequest {
    try {
      return this.rejectRequest.execute({ requestId: id });
    } catch (err) {
      if (err instanceof RequestNotFoundError) {
        throw new NotFoundException({
          code: 'REQUEST_NOT_FOUND',
          message: err.message,
        });
      }
      if (err instanceof InvalidTransitionError) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: err.message,
          currentStatus: err.from,
        });
      }
      throw err;
    }
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string): TimeOffRequest {
    try {
      return this.cancelRequest.execute({ requestId: id });
    } catch (err) {
      if (err instanceof RequestNotFoundError) {
        throw new NotFoundException({
          code: 'REQUEST_NOT_FOUND',
          message: err.message,
        });
      }
      if (err instanceof InvalidTransitionError) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: err.message,
          currentStatus: err.from,
        });
      }
      throw err;
    }
  }
}
