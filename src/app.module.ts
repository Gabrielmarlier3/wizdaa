import { Module } from '@nestjs/common';
import { BalanceModule } from './balance/balance.module';
import { DatabaseModule } from './database/database.module';
import { TimeOffModule } from './time-off/time-off.module';

@Module({
  imports: [DatabaseModule, TimeOffModule, BalanceModule],
})
export class AppModule {}
