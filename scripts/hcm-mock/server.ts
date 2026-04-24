/**
 * Standalone mock HCM server (TRD §3 contract, §9 decision
 * "Mock HCM is a standalone Express app").
 *
 * Grew beyond slice 1's health-and-reset skeleton: the approve
 * slice needs the realtime mutation endpoint (TRD §3.2) and
 * scenario-injection hooks so e2e tests can deterministically
 * drive HCM failure modes.
 */
import { randomUUID } from 'node:crypto';
import express, { Express, Request, Response } from 'express';

type Scenario =
  | 'normal'
  | 'force500'
  | 'forceTimeout'
  | 'forcePermanent'
  | 'forceBadShape';

interface MutationOutcome {
  status: number;
  body: unknown;
}

interface MutationRecord {
  idempotencyKey: string;
  clientMutationId: string;
  hcmMutationId: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  days: number;
  reason: string;
}

interface MockState {
  scenario: Scenario;
  // Idempotency-Key → canonical outcome. Stored for any terminal
  // response (2xx or 4xx) so retries replay exactly what the first
  // call produced. 5xx / timeout are transient by definition and
  // not stored — a retry is allowed to reach a different outcome.
  outcomesByKey: Map<string, MutationOutcome>;
  // Ordered list of accepted (2xx) mutations, for test inspection.
  mutationsLog: MutationRecord[];
}

function freshState(): MockState {
  return {
    scenario: 'normal',
    outcomesByKey: new Map(),
    mutationsLog: [],
  };
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

  app.post('/test/scenario', (req: Request, res: Response) => {
    const mode = (req.body as { mode?: unknown } | undefined)?.mode;
    const allowed: Scenario[] = [
      'normal',
      'force500',
      'forceTimeout',
      'forcePermanent',
      'forceBadShape',
    ];
    if (typeof mode !== 'string' || !allowed.includes(mode as Scenario)) {
      res.status(400).json({ code: 'INVALID_MODE', message: `Expected one of ${allowed.join(', ')}` });
      return;
    }
    state.scenario = mode as Scenario;
    res.status(204).send();
  });

  app.get('/test/state', (_req: Request, res: Response) => {
    res.status(200).json({
      scenario: state.scenario,
      mutations: state.mutationsLog,
    });
  });

  app.post('/balance/mutations', async (req: Request, res: Response) => {
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      res.status(400).json({
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required',
      });
      return;
    }

    const body = req.body as {
      employeeId?: string;
      locationId?: string;
      leaveType?: string;
      days?: number;
      reason?: string;
      clientMutationId?: string;
    };

    // Idempotent replay: any terminal outcome (2xx or 4xx) stored
    // under the key is replayed exactly. 5xx / timeout are transient
    // by definition and not stored — a retry is allowed to reach a
    // different scenario.
    const prior = state.outcomesByKey.get(idempotencyKey);
    if (prior) {
      res.status(prior.status).json(prior.body);
      return;
    }

    switch (state.scenario) {
      case 'force500':
        res.status(500).json({ code: 'HCM_UNAVAILABLE' });
        return;
      case 'forcePermanent': {
        const outcome: MutationOutcome = {
          status: 409,
          body: {
            code: 'insufficient_balance',
            message: 'HCM rejects this mutation permanently.',
          },
        };
        state.outcomesByKey.set(idempotencyKey, outcome);
        res.status(outcome.status).json(outcome.body);
        return;
      }
      case 'forceTimeout':
        // Do not respond — let the client abort via its timeout.
        // Hold the request open longer than any reasonable test
        // timeout budget; the test runner's globalTeardown closes
        // the server.
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        return;
      case 'forceBadShape': {
        const outcome: MutationOutcome = {
          status: 200,
          body: { nope: 'missing-hcmMutationId' },
        };
        state.outcomesByKey.set(idempotencyKey, outcome);
        res.status(outcome.status).json(outcome.body);
        return;
      }
      case 'normal':
      default:
        break;
    }

    if (
      typeof body.employeeId !== 'string' ||
      typeof body.locationId !== 'string' ||
      typeof body.leaveType !== 'string' ||
      typeof body.days !== 'number' ||
      typeof body.clientMutationId !== 'string'
    ) {
      res.status(422).json({
        code: 'invalid_body',
        message: 'Malformed mutation payload.',
      });
      return;
    }

    const record: MutationRecord = {
      idempotencyKey,
      clientMutationId: body.clientMutationId,
      hcmMutationId: randomUUID(),
      employeeId: body.employeeId,
      locationId: body.locationId,
      leaveType: body.leaveType,
      days: body.days,
      reason: body.reason ?? '',
    };
    state.outcomesByKey.set(idempotencyKey, {
      status: 200,
      body: { hcmMutationId: record.hcmMutationId },
    });
    state.mutationsLog.push(record);
    res.status(200).json({ hcmMutationId: record.hcmMutationId });
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
