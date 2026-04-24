import {
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  Matches,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateRequestDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsString()
  @IsNotEmpty()
  leaveType!: string;

  @IsString()
  @Matches(ISO_DATE, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;

  @IsString()
  @Matches(ISO_DATE, { message: 'endDate must be YYYY-MM-DD' })
  endDate!: string;

  @IsInt()
  @IsPositive()
  days!: number;

  @IsString()
  @IsNotEmpty()
  clientRequestId!: string;
}
