import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { TimeOffModule } from './time-off/time-off.module';

@Module({
  imports: [DatabaseModule, TimeOffModule],
})
export class AppModule {}
