const express = require('express');
const request = require('supertest');
const authRouter = require('../auth');

// Mock auth middleware
jest.mock('../../auth', () => ({
  auth: jest.fn((req, res, next) => {
    // Default: simulate authenticated user
    req.user = { id: 'user-123', username: 'testuser' };
    next();
  }),
  checkPermission: jest.fn(),
  ensureRefreshToken: jest.fn(),
}));

// Mock tokenService
jest.mock('../../tokenService', () => ({
  isTokenUsed: jest.fn(),
  getUserIdFromUsedToken: jest.fn(),
  verifyRefreshToken: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeAllUserTokens: jest.fn(),
}));

// Mock axios
jest.mock('axios', () => ({
  post: jest.fn(),
}));

// Mock redis
jest.mock('../../redis', () => ({
  incr: jest.fn(),
  expire: jest.fn(),
}));

const tokenService = require('../../tokenService');
const axios = require('axios');
const redis = require('../../redis');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

describe('POST /api/auth/refresh', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    // Default: rate limit not exceeded
    redis.incr.mockResolvedValue(1);
    redis.expire.mockResolvedValue(1);
  });

  it('should return 400 when refreshToken is missing', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('refresh token 不能为空');
  });

  it('should return 400 when body is empty', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('refresh token 不能为空');
  });

  it('should return 401 on replay attack and revoke all user tokens', async () => {
    tokenService.isTokenUsed.mockResolvedValue(true);
    tokenService.getUserIdFromUsedToken.mockResolvedValue('user-123');
    tokenService.revokeAllUserTokens.mockResolvedValue();

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'used-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('检测到异常，请重新登录');
    expect(tokenService.revokeAllUserTokens).toHaveBeenCalledWith('user-123');
  });

  it('should return 401 on replay attack even when userId is not found', async () => {
    tokenService.isTokenUsed.mockResolvedValue(true);
    tokenService.getUserIdFromUsedToken.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'used-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('检测到异常，请重新登录');
    expect(tokenService.revokeAllUserTokens).not.toHaveBeenCalled();
  });

  it('should return 401 when refresh token is invalid', async () => {
    tokenService.isTokenUsed.mockResolvedValue(false);
    tokenService.verifyRefreshToken.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('refresh token 无效或已过期');
  });

  it('should return 502 when main backend is unavailable', async () => {
    tokenService.isTokenUsed.mockResolvedValue(false);
    tokenService.verifyRefreshToken.mockResolvedValue('user-123');
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid-token' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('认证服务暂时不可用');
  });

  it('should return 502 when main backend returns non-zero code', async () => {
    tokenService.isTokenUsed.mockResolvedValue(false);
    tokenService.verifyRefreshToken.mockResolvedValue('user-123');
    axios.post.mockResolvedValue({
      data: { code: 1, message: 'Internal error' },
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid-token' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('认证服务暂时不可用');
  });

  it('should return new tokens on successful refresh', async () => {
    tokenService.isTokenUsed.mockResolvedValue(false);
    tokenService.verifyRefreshToken.mockResolvedValue('user-123');
    axios.post.mockResolvedValue({
      data: { code: 0, data: { accessToken: 'new-access-token' } },
    });
    tokenService.rotateRefreshToken.mockResolvedValue('new-refresh-token');

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid-token' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
    expect(tokenService.rotateRefreshToken).toHaveBeenCalledWith('valid-token', 'user-123');
  });

  it('should call main backend with correct userId', async () => {
    tokenService.isTokenUsed.mockResolvedValue(false);
    tokenService.verifyRefreshToken.mockResolvedValue('user-456');
    axios.post.mockResolvedValue({
      data: { code: 0, data: { accessToken: 'token-abc' } },
    });
    tokenService.rotateRefreshToken.mockResolvedValue('new-rt');

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'some-token' });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/v1/plugin/refresh-token'),
      { userId: 'user-456' }
    );
  });

  describe('rate limiting', () => {
    it('should return 429 when rate limit is exceeded', async () => {
      tokenService.isTokenUsed.mockResolvedValue(false);
      tokenService.verifyRefreshToken.mockResolvedValue('user-123');
      redis.incr.mockResolvedValue(11); // exceeds default limit of 10

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('请求过于频繁，请稍后再试');
    });

    it('should allow requests within rate limit', async () => {
      tokenService.isTokenUsed.mockResolvedValue(false);
      tokenService.verifyRefreshToken.mockResolvedValue('user-123');
      redis.incr.mockResolvedValue(10); // exactly at limit, should still pass
      axios.post.mockResolvedValue({
        data: { code: 0, data: { accessToken: 'new-at' } },
      });
      tokenService.rotateRefreshToken.mockResolvedValue('new-rt');

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(res.status).toBe(200);
    });

    it('should set TTL on first request in window', async () => {
      tokenService.isTokenUsed.mockResolvedValue(false);
      tokenService.verifyRefreshToken.mockResolvedValue('user-123');
      redis.incr.mockResolvedValue(1); // first request
      axios.post.mockResolvedValue({
        data: { code: 0, data: { accessToken: 'new-at' } },
      });
      tokenService.rotateRefreshToken.mockResolvedValue('new-rt');

      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(redis.expire).toHaveBeenCalledWith(
        'rate_limit:refresh:user-123',
        60
      );
    });

    it('should not reset TTL on subsequent requests', async () => {
      tokenService.isTokenUsed.mockResolvedValue(false);
      tokenService.verifyRefreshToken.mockResolvedValue('user-123');
      redis.incr.mockResolvedValue(5); // not first request
      axios.post.mockResolvedValue({
        data: { code: 0, data: { accessToken: 'new-at' } },
      });
      tokenService.rotateRefreshToken.mockResolvedValue('new-rt');

      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('should use correct rate limit key with user id', async () => {
      tokenService.isTokenUsed.mockResolvedValue(false);
      tokenService.verifyRefreshToken.mockResolvedValue('user-789');
      redis.incr.mockResolvedValue(11);

      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(redis.incr).toHaveBeenCalledWith('rate_limit:refresh:user-789');
    });

    it('should not check rate limit for invalid tokens', async () => {
      tokenService.isTokenUsed.mockResolvedValue(false);
      tokenService.verifyRefreshToken.mockResolvedValue(null);

      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(redis.incr).not.toHaveBeenCalled();
    });
  });
});

const { auth: authMiddleware } = require('../../auth');

describe('POST /api/auth/logout', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    // Default: authenticated user
    authMiddleware.mockImplementation((req, res, next) => {
      req.user = { id: 'user-123', username: 'testuser' };
      next();
    });
  });

  it('should return success and revoke all tokens for authenticated user', async () => {
    tokenService.revokeAllUserTokens.mockResolvedValue();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer some-token');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('登出成功');
    expect(tokenService.revokeAllUserTokens).toHaveBeenCalledWith('user-123');
  });

  it('should convert numeric user id to string', async () => {
    authMiddleware.mockImplementation((req, res, next) => {
      req.user = { id: 456, username: 'numericuser' };
      next();
    });
    tokenService.revokeAllUserTokens.mockResolvedValue();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer some-token');

    expect(res.status).toBe(200);
    expect(tokenService.revokeAllUserTokens).toHaveBeenCalledWith('456');
  });

  it('should return 401 when not authenticated', async () => {
    authMiddleware.mockImplementation((req, res) => {
      res.status(401).json({ error: '未登录，请先在主系统登录' });
    });

    const res = await request(app)
      .post('/api/auth/logout');

    expect(res.status).toBe(401);
    expect(tokenService.revokeAllUserTokens).not.toHaveBeenCalled();
  });

  it('should return 500 when revokeAllUserTokens fails', async () => {
    tokenService.revokeAllUserTokens.mockRejectedValue(new Error('Redis error'));

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer some-token');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('服务内部错误');
  });
});
