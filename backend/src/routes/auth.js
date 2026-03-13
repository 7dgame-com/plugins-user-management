const express = require('express');
const axios = require('axios');
const tokenService = require('../tokenService');
const redis = require('../redis');
const { auth } = require('../auth');

const router = express.Router();

const MAIN_API_BASE = process.env.MAIN_API_URL || 'http://localhost:8091';
const REFRESH_RATE_LIMIT = parseInt(process.env.REFRESH_RATE_LIMIT || '10', 10);
const RATE_LIMIT_WINDOW = 60; // seconds

/**
 * 检查用户刷新请求速率限制
 * 使用 Redis 滑动窗口计数，每用户每分钟最多 REFRESH_RATE_LIMIT 次
 * @param {string} userId - 用户 ID
 * @returns {Promise<boolean>} 超过限制返回 true
 */
async function checkRateLimit(userId) {
  const key = `rate_limit:refresh:${userId}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW);
  }
  return current > REFRESH_RATE_LIMIT;
}

/**
 * POST /api/auth/refresh
 * 使用 refresh token 获取新的 access token 和 refresh token
 */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  // 1. 检查 refreshToken 是否存在
  if (!refreshToken) {
    return res.status(400).json({ error: 'refresh token 不能为空' });
  }

  try {
    // 2. 检测重放攻击
    const used = await tokenService.isTokenUsed(refreshToken);
    if (used) {
      const userId = await tokenService.getUserIdFromUsedToken(refreshToken);
      if (userId) {
        await tokenService.revokeAllUserTokens(userId);
      }
      console.warn('[Auth] Replay attack detected for refresh token');
      return res.status(401).json({ error: '检测到异常，请重新登录' });
    }

    // 3. 验证 refresh token
    const userId = await tokenService.verifyRefreshToken(refreshToken);
    if (!userId) {
      return res.status(401).json({ error: 'refresh token 无效或已过期' });
    }

    // 4. 速率限制检查
    const rateLimited = await checkRateLimit(userId);
    if (rateLimited) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }

    // 5. 调用主后端请求新 access token
    let accessToken;
    try {
      const response = await axios.post(`${MAIN_API_BASE}/v1/plugin/refresh-token`, {
        userId,
      });
      if (response.data.code === 0) {
        accessToken = response.data.data.accessToken;
      } else {
        console.error('[Auth] Main backend refresh failed:', response.data.message);
        return res.status(502).json({ error: '认证服务暂时不可用' });
      }
    } catch (err) {
      console.error('[Auth] Main backend unavailable:', err.message);
      return res.status(502).json({ error: '认证服务暂时不可用' });
    }

    // 6. 轮换 refresh token
    const newRefreshToken = await tokenService.rotateRefreshToken(refreshToken, userId);

    // 7. 返回新 token
    return res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    console.error('[Auth] Refresh token error:', err.message);
    return res.status(500).json({ error: '服务内部错误' });
  }
});

/**
 * POST /api/auth/logout
 * 登出：撤销该用户的所有 refresh token
 * 需要认证（通过 auth 中间件）
 */
router.post('/logout', auth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    await tokenService.revokeAllUserTokens(userId);
    return res.json({ message: '登出成功' });
  } catch (err) {
    console.error('[Auth] Logout error:', err.message);
    return res.status(500).json({ error: '服务内部错误' });
  }
});

module.exports = router;
