import request from 'supertest';
import { app } from '../../src/app';
import { sequelize } from '../../src/config/database';
import * as redisModule from '../../src/config/redis';

describe('Health Check Endpoints', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GET /health should return 200 and healthy status when services are connected', async () => {
    jest.spyOn(sequelize, 'authenticate').mockResolvedValue();
    jest.spyOn(redisModule, 'checkRedisHealth').mockResolvedValue(true);

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('UP');
    expect(response.body.data.services.database).toBe('CONNECTED');
    expect(response.body.data.services.redis).toBe('CONNECTED');
    expect(response.body.data).toHaveProperty('timestamp');
    expect(response.body.data).toHaveProperty('uptime');
  });

  it('GET /api/v1/health should also respond with health status', async () => {
    jest.spyOn(sequelize, 'authenticate').mockResolvedValue();
    jest.spyOn(redisModule, 'checkRedisHealth').mockResolvedValue(true);

    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('UP');
  });

  it('GET /health should return 503 when database is disconnected', async () => {
    jest.spyOn(sequelize, 'authenticate').mockRejectedValue(new Error('DB connection failed'));
    jest.spyOn(redisModule, 'checkRedisHealth').mockResolvedValue(true);

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.data.status).toBe('DOWN');
    expect(response.body.data.services.database).toBe('DISCONNECTED');
    expect(response.body.data.services.redis).toBe('CONNECTED');
  });

  it('GET /non-existent-route should return structured 404 error envelope', async () => {
    const response = await request(app).get('/api/v1/non-existent-route');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBeDefined();
    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(response.body.error).toHaveProperty('requestId');
    expect(response.body.error).toHaveProperty('timestamp');
  });
});
