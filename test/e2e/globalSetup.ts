import type { Server } from 'node:http';
import { createMockHcmServer } from '../../scripts/hcm-mock/server';

declare global {
  // eslint-disable-next-line no-var
  var __MOCK_HCM_SERVER__: Server | undefined;
}

export default async function setup(): Promise<void> {
  const port = Number(process.env.HCM_MOCK_PORT ?? 4100);
  const app = createMockHcmServer();
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, () => resolve(s));
    s.once('error', reject);
  });
  globalThis.__MOCK_HCM_SERVER__ = server;
  process.env.HCM_MOCK_URL = `http://127.0.0.1:${port}`;
}
