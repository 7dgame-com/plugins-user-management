const express = require('express');
const request = require('supertest');

// Mock dependencies
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock('../redis', () => ({
  incr: jest.fn(),
  expire: jest.fn(),
  scard: jest.fn(),
}));

jest.mock('../tokenService', () => ({
  isTokenUsed: jest.fn(),
  getUserIdFromUsedToken: jest.fn(),
  verifyRefreshToken: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeAllUserTokens: jest.fn(),
  generateRefreshToken: jest.fn(),
}));

const axios = require('axios');
const redis = require('../redis');
const tokenService = require('../tokenService');
const authRoutes = require('../routes/auth');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

describe('POST /api/auth/refresh', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    // Default: no rate limit
    redis.incr.mockResolvedValue(1);
  });

  it('should return 400 when refreshToken is missing', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/不能为空/);
  });

  it('should return 401 when replay attack detected', async () => {
    tokenService.isTokenUsed.mockResolvedValue(true);
    tokenService.getUserIdFromUsedToken.mockResolvedValue('42');
    tokenService.revokeAllUserTokens.mockResolvedValue();

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'reused-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/重新登录/);
    // Should revoke all tokens for the user
    expect(tokenService.revokeAllUserTokens).toHaveBeenCalledWith('42');

    consoleSpy.mockRestore();
  });

  it('should return 401 when refresh token is invalid', async () => {
    tokenService.isTokenUsed.mockResolvedValue(false);
    tokenService.verifyRefreshToken.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/无效|过期/);
  });

  it('should return 429 when rate limited', async () => {
    tokenService.isTokenUsed.mockResolvedValue(false);
    tokenService.verifyRefreshToken.mockResolvedValue('42');
    redis.incr.mockResolvedValue(999); // way over limit

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid-token' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/频繁/);
  });

  it('should return 502 when main backend returns error code', async () => {
    tokenService.isTokenUsed.mockResolvedValue(false);
    tokenService.verifyRefreshToken.mockResolvedValue('42');
    axios.post.mockResolvedValue({
      data: { code: 1, message: '用户已被禁用' },
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid-token' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/不可用/);

    consoleSpy.mockRestore();
  });

  it('should return 502 when main backend is unreachable', async () => {
    tokenService.isTokenUsed.mockResolvedValue(false);
    tokenService.verifyRefreshToken.mockResolvedValue('42');
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid-token' });

    expect(res.status).toBe(502);

    consoleSpy.mockRestore();
  });

  it('should return new tokens on successful refresh', async () => {
    tokenService.isTokenUsed.mockResolvedValue(false);
    tokenService.verifyRefreshToken.mockResolvedValue('42');
    axios.post.mockResolvedValue({
      data: { code: 0, data: { accessToken: 'new-jwt-abc' } },
    });
    tokenService.rotateRefreshToken.mockResolvedValue('new-refresh-xyz');

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'old-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('new-jwt-abc');
    expect(res.body.refreshToken).toBe('new-refresh-xyz');

    // Verify main backend was called with correct userId
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/v1/plugin/refresh-token'),
      { userId: '42' }
    );
    // Verify token rotation
    expect(tokenService.rotateRefreshToken).toHaveBeenCalledWith('old-refresh-token', '42');
  });

  it('should handle internal errors gracefully', async () => {
    tokenService.isTokenUsed.mockRejectedValue(new Error('unexpected'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'some-token' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/内部错误/);

    consoleSpy.mockRestore();
  });
});

describe('POST /api/auth/logout', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should return 401 without Authorization header', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  it('should revoke all tokens and return success', async () => {
    // Mock auth middleware to pass
    axios.get.mockResolvedValue({
      data: { code: 0, data: { id: 42, username: 'alice' } },
    });
    redis.scard.mockResolvedValue(1); // has existing tokens, skip generation
    tokenService.revokeAllUserTokens.mockResolvedValue();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer valid-jwt');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/登出成功/);
    expect(tokenService.revokeAllUserTokens).toHaveBeenCalledWith('42');
  });
});
