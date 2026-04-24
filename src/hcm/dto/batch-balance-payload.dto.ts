import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class BatchBalanceItemDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsString()
  @IsNotEmpty()
  leaveType!: string;

  @IsInt()
  @Min(0)
  balance!: number;
}

export class BatchBalancePayloadDto {
  @IsISO8601()
  generatedAt!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchBalanceItemDto)
  balances!: BatchBalanceItemDto[];
}
