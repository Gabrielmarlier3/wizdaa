import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildTestApp } from '../helpers/test-app';

describe('POST /requests', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a pending request with a balance hold when balance is sufficient', async () => {
    // Given a valid create-request payload.
    const response = await request(app.getHttpServer())
      .post('/requests')
      .send({
        employeeId: 'emp-001',
        locationId: 'loc-BR',
        leaveType: 'PTO',
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days: 2,
        clientRequestId: 'req-uuid-001',
      });

    // Expect the service to accept it and return the new pending request.
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      status: 'pending',
      employeeId: 'emp-001',
      locationId: 'loc-BR',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
      clientRequestId: 'req-uuid-001',
    });
  });
});
