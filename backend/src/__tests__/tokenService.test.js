const crypto = require('crypto');

// Mock redis before requiring tokenService
jest.mock('../redis', () => {
  const pipeline = {
    sadd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    hset: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
  return {
    pipeline: jest.fn(() => pipeline),
    hgetall: jest.fn(),
    sismember: jest.fn(),
    exists: jest.fn(),
    get: jest.fn(),
    smembers: jest.fn(),
    __pipeline: pipeline,
  };
});

const redis = require('../redis');
const tokenService = require('../tokenService');

describe('tokenService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('hashToken', () => {
    it('should return a SHA-256 hex hash', () => {
      const hash = tokenService.hashToken('test-token');
      const expected = crypto.createHash('sha256').update('test-token').digest('hex');
      expect(hash).toBe(expected);
      expect(hash).toHaveLength(64);
    });

    it('should produce different hashes for different tokens', () => {
      const h1 = tokenService.hashToken('token-a');
      const h2 = tokenService.hashToken('token-b');
      expect(h1).not.toBe(h2);
    });
  });

  describe('generateRefreshToken', () => {
    it('should return a 64-char hex string and store in Redis', async () => {
      const token = await tokenService.generateRefreshToken('42');

      expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(redis.pipeline).toHaveBeenCalled();

      const pl = redis.__pipeline;
      // Should add hash to user's SET
      expect(pl.sadd).toHaveBeenCalledWith(
        'refresh_token:42',
        expect.stringMatching(/^[a-f0-9]{64}$/)
      );
      // Should store metadata
      expect(pl.hset).toHaveBeenCalledWith(
        expect.stringMatching(/^refresh_token_data:[a-f0-9]{64}$/),
        'userId', '42',
        'createdAt', expect.any(String),
        'expiresAt', expect.any(String)
      );
      expect(pl.exec).toHaveBeenCalled();
    });
  });

  describe('verifyRefreshToken', () => {
    it('should return userId for a valid token', async () => {
      const rawToken = 'valid-raw-token';
      const hash = tokenService.hashToken(rawToken);
      const now = Math.floor(Date.now() / 1000);

      redis.hgetall.mockResolvedValue({
        userId: '42',
        expiresAt: String(now + 3600),
      });
      redis.sismember.mockResolvedValue(1);

      const result = await tokenService.verifyRefreshToken(rawToken);
      expect(result).toBe('42');
      expect(redis.hgetall).toHaveBeenCalledWith(`refresh_token_data:${hash}`);
      expect(redis.sismember).toHaveBeenCalledWith('refresh_token:42', hash);
    });

    it('should return null for empty token', async () => {
      expect(await tokenService.verifyRefreshToken(null)).toBeNull();
      expect(await tokenService.verifyRefreshToken('')).toBeNull();
    });

    it('should return null when token metadata not found', async () => {
      redis.hgetall.mockResolvedValue({});
      expect(await tokenService.verifyRefreshToken('unknown')).toBeNull();
    });

    it('should return null for expired token', async () => {
      const now = Math.floor(Date.now() / 1000);
      redis.hgetall.mockResolvedValue({
        userId: '42',
        expiresAt: String(now - 100), // expired
      });
      expect(await tokenService.verifyRefreshToken('expired-token')).toBeNull();
    });

    it('should return null when token hash not in user SET', async () => {
      const now = Math.floor(Date.now() / 1000);
      redis.hgetall.mockResolvedValue({
        userId: '42',
        expiresAt: String(now + 3600),
      });
      redis.sismember.mockResolvedValue(0); // not a member

      expect(await tokenService.verifyRefreshToken('revoked-token')).toBeNull();
    });
  });

  describe('rotateRefreshToken', () => {
    it('should revoke old token and generate a new one', async () => {
      const oldToken = 'old-token-abc';
      const oldHash = tokenService.hashToken(oldToken);

      const result = await tokenService.rotateRefreshToken(oldToken, '42');

      const pl = redis.__pipeline;
      // Should remove old hash from user SET
      expect(pl.srem).toHaveBeenCalledWith('refresh_token:42', oldHash);
      // Should mark old token as used (replay detection)
      expect(pl.set).toHaveBeenCalledWith(
        `refresh_token_used:${oldHash}`,
        '42',
        'EX',
        expect.any(Number)
      );
      // Should delete old token metadata
      expect(pl.del).toHaveBeenCalledWith(`refresh_token_data:${oldHash}`);

      // Should return a new token (64 hex chars)
      expect(result).toHaveLength(64);
      expect(result).not.toBe(oldToken);
    });
  });

  describe('isTokenUsed', () => {
    it('should return true when token was previously used', async () => {
      redis.exists.mockResolvedValue(1);
      const hash = tokenService.hashToken('used-token');
      expect(await tokenService.isTokenUsed('used-token')).toBe(true);
      expect(redis.exists).toHaveBeenCalledWith(`refresh_token_used:${hash}`);
    });

    it('should return false when token was not used', async () => {
      redis.exists.mockResolvedValue(0);
      expect(await tokenService.isTokenUsed('fresh-token')).toBe(false);
    });

    it('should return false for empty token', async () => {
      expect(await tokenService.isTokenUsed(null)).toBe(false);
      expect(await tokenService.isTokenUsed('')).toBe(false);
    });
  });

  describe('revokeAllUserTokens', () => {
    it('should delete all token data and the user SET', async () => {
      redis.smembers.mockResolvedValue(['hash1', 'hash2']);

      await tokenService.revokeAllUserTokens('42');

      const pl = redis.__pipeline;
      expect(pl.del).toHaveBeenCalledWith('refresh_token_data:hash1');
      expect(pl.del).toHaveBeenCalledWith('refresh_token_data:hash2');
      expect(pl.del).toHaveBeenCalledWith('refresh_token:42');
      expect(pl.exec).toHaveBeenCalled();
    });

    it('should handle user with no tokens gracefully', async () => {
      redis.smembers.mockResolvedValue([]);
      await tokenService.revokeAllUserTokens('99');

      const pl = redis.__pipeline;
      expect(pl.del).toHaveBeenCalledWith('refresh_token:99');
    });
  });

  describe('getUserIdFromUsedToken', () => {
    it('should return userId from used token record', async () => {
      const hash = tokenService.hashToken('used-token');
      redis.get.mockResolvedValue('42');
      expect(await tokenService.getUserIdFromUsedToken('used-token')).toBe('42');
      expect(redis.get).toHaveBeenCalledWith(`refresh_token_used:${hash}`);
    });

    it('should return null for legacy "1" format', async () => {
      redis.get.mockResolvedValue('1');
      expect(await tokenService.getUserIdFromUsedToken('old-token')).toBeNull();
    });

    it('should return null for empty token', async () => {
      expect(await tokenService.getUserIdFromUsedToken(null)).toBeNull();
      expect(await tokenService.getUserIdFromUsedToken('')).toBeNull();
    });

    it('should return null when no record exists', async () => {
      redis.get.mockResolvedValue(null);
      expect(await tokenService.getUserIdFromUsedToken('unknown')).toBeNull();
    });
  });
});
