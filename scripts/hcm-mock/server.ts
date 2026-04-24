/**
 * Standalone mock HCM server (TRD §3 contract, §9 decision
 * "Mock HCM is a standalone Express app").
 *
 * This file is intentionally minimal for Phase B: a health probe and
 * a state-reset hook. Realtime balance endpoints, batch push intake,
 * and scenario injection are added per slice as their integration
 * tests demand them.
 */
import express, { Express, Request, Response } from 'express';

interface MockState {
  // Populated slice-by-slice. Keeping the shape explicit from the
  // start so scenario-injection can clear every field in one place.
  scenarios: Record<string, unknown>;
}

function freshState(): MockState {
  return { scenarios: {} };
}

let state: MockState = freshState();

export function resetState(): void {
  state = freshState();
}

export function getState(): MockState {
  return state;
}

export function createMockHcmServer(): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/test/reset', (_req: Request, res: Response) => {
    resetState();
    res.status(204).send();
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.HCM_MOCK_PORT ?? 4000);
  const app = createMockHcmServer();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Mock HCM listening on http://localhost:${port}`);
  });
}
