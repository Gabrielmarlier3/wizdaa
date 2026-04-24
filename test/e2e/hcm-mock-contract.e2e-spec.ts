/**
 * Contract tests for the mock HCM server (scripts/hcm-mock/server.ts).
 * These do not exercise the service under test — they pin the
 * behaviours the mock must honour so the deferred outbox-worker
 * slice can rely on them (notably: the idempotency-key dedup,
 * TRD §3.2).
 */

async function resetMock(): Promise<void> {
  await fetch(`${process.env.HCM_MOCK_URL}/test/reset`, {
    method: 'POST',
  });
}

describe('Mock HCM contract', () => {
  beforeEach(async () => {
    await resetMock();
  });

  it('returns the same hcmMutationId for a retry with the same Idempotency-Key', async () => {
    const body = {
      employeeId: 'emp-dedup',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      days: -2,
      reason: 'TIME_OFF_APPROVED',
      clientMutationId: 'client-mutation-01',
    };
    const key = 'idempotency-key-dedup-01';

    const first = await fetch(
      `${process.env.HCM_MOCK_URL}/balance/mutations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { hcmMutationId: string };
    expect(firstBody.hcmMutationId).toEqual(expect.any(String));

    const second = await fetch(
      `${process.env.HCM_MOCK_URL}/balance/mutations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { hcmMutationId: string };

    expect(secondBody.hcmMutationId).toBe(firstBody.hcmMutationId);

    // The log shows a single accepted mutation; the replay did not
    // create a second record.
    const state = (await (
      await fetch(`${process.env.HCM_MOCK_URL}/test/state`)
    ).json()) as { mutations: { idempotencyKey: string }[] };
    expect(state.mutations).toHaveLength(1);
    expect(state.mutations[0].idempotencyKey).toBe(key);
  });

  it('mints distinct hcmMutationIds for different Idempotency-Keys', async () => {
    const body = {
      employeeId: 'emp-distinct',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      days: -1,
      reason: 'TIME_OFF_APPROVED',
      clientMutationId: 'client-mutation-02',
    };

    const makeCall = async (key: string): Promise<string> => {
      const res = await fetch(
        `${process.env.HCM_MOCK_URL}/balance/mutations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify(body),
        },
      );
      expect(res.status).toBe(200);
      const parsed = (await res.json()) as { hcmMutationId: string };
      return parsed.hcmMutationId;
    };

    const idA = await makeCall('key-A');
    const idB = await makeCall('key-B');
    expect(idA).not.toBe(idB);
  });

  it('rejects a POST /balance/mutations without an Idempotency-Key header', async () => {
    const res = await fetch(
      `${process.env.HCM_MOCK_URL}/balance/mutations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: 'emp',
          locationId: 'loc',
          leaveType: 'PTO',
          days: -1,
          clientMutationId: 'c1',
        }),
      },
    );
    expect(res.status).toBe(400);
  });
});
