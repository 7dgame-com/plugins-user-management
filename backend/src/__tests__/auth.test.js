const express = require('express');
const request = require('supertest');
const { auth, ensureRefreshToken } = require('../auth');

// Mock axios
jest.mock('axios', () => ({
  get: jest.fn(),
}));

// Mock redis
jest.mock('../redis', () => ({
  scard: jest.fn(),
}));

// Mock tokenService
jest.mock('../tokenService', () => ({
  generateRefreshToken: jest.fn(),
}));

const axios = require('axios');
const redis = require('../redis');
const tokenService = require('../tokenService');

function createApp() {
  const app = express();
  app.use(express.json());
  app.get('/test', auth, (req, res) => {
    res.json({ user: req.user });
  });
  return app;
}

describe('auth middleware - refresh token generation', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should generate refresh token and set X-Refresh-Token header when user has no existing refresh token', async () => {
    axios.get.mockResolvedValue({
      data: { code: 0, data: { id: 42, username: 'alice' } },
    });
    redis.scard.mockResolvedValue(0);
    tokenService.generateRefreshToken.mockResolvedValue('new-refresh-token-abc');

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.headers['x-refresh-token']).toBe('new-refresh-token-abc');
    expect(redis.scard).toHaveBeenCalledWith('refresh_token:42');
    expect(tokenService.generateRefreshToken).toHaveBeenCalledWith('42');
  });

  it('should NOT generate refresh token when user already has one', async () => {
    axios.get.mockResolvedValue({
      data: { code: 0, data: { id: 10, username: 'bob' } },
    });
    redis.scard.mockResolvedValue(2); // user has 2 existing refresh tokens

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.headers['x-refresh-token']).toBeUndefined();
    expect(tokenService.generateRefreshToken).not.toHaveBeenCalled();
  });

  it('should still proceed with request when refresh token generation fails', async () => {
    axios.get.mockResolvedValue({
      data: { code: 0, data: { id: 5, username: 'charlie' } },
    });
    redis.scard.mockRejectedValue(new Error('Redis connection error'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 5, username: 'charlie' });
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Auth] Failed to ensure refresh token:',
      'Redis connection error'
    );

    consoleSpy.mockRestore();
  });

  it('should not check refresh token when auth fails', async () => {
    axios.get.mockResolvedValue({
      data: { code: 1, message: '认证失败' },
    });

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
    expect(redis.scard).not.toHaveBeenCalled();
    expect(tokenService.generateRefreshToken).not.toHaveBeenCalled();
  });

  it('should not check refresh token when no Authorization header', async () => {
    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(redis.scard).not.toHaveBeenCalled();
  });

  it('should convert user id to string when checking Redis', async () => {
    axios.get.mockResolvedValue({
      data: { code: 0, data: { id: 123, username: 'dave' } },
    });
    redis.scard.mockResolvedValue(0);
    tokenService.generateRefreshToken.mockResolvedValue('token-xyz');

    await request(app)
      .get('/test')
      .set('Authorization', 'Bearer valid-token');

    expect(redis.scard).toHaveBeenCalledWith('refresh_token:123');
    expect(tokenService.generateRefreshToken).toHaveBeenCalledWith('123');
  });
});
