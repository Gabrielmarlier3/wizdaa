import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, Db, DatabasePair } from './connection';

export const DATABASE = Symbol('DATABASE');
export const DATABASE_PAIR = Symbol('DATABASE_PAIR');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_PAIR,
      useFactory: (): DatabasePair => {
        const path = process.env.DB_PATH ?? './wizdaa.db';
        return createDatabase({ path });
      },
    },
    {
      provide: DATABASE,
      useFactory: (pair: DatabasePair): Db => pair.db,
      inject: [DATABASE_PAIR],
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_PAIR) private readonly pair: DatabasePair) {}

  onApplicationShutdown(): void {
    this.pair.client.close();
  }
}
