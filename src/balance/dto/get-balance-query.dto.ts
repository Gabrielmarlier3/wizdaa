import { IsNotEmpty, IsString } from 'class-validator';

export class GetBalanceQueryDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsString()
  @IsNotEmpty()
  leaveType!: string;
}
