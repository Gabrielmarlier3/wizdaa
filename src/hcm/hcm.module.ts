import { Module } from '@nestjs/common';
import { HcmClient, HCM_BASE_URL, HCM_TIMEOUT_MS } from './hcm.client';
import { HcmOutboxRepository } from './repositories/hcm-outbox.repository';
import { InconsistenciesRepository } from './repositories/inconsistencies.repository';

@Module({
  providers: [
    {
      provide: HCM_BASE_URL,
      useFactory: (): string =>
        process.env.HCM_BASE_URL ??
        process.env.HCM_MOCK_URL ??
        'http://127.0.0.1:4100',
    },
    {
      provide: HCM_TIMEOUT_MS,
      useFactory: (): number => Number(process.env.HCM_TIMEOUT_MS ?? 2000),
    },
    HcmClient,
    HcmOutboxRepository,
    InconsistenciesRepository,
  ],
  exports: [HcmClient, HcmOutboxRepository, InconsistenciesRepository],
})
export class HcmModule {}
