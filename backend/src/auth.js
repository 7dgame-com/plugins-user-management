const axios = require('axios');
const redis = require('./redis');
const tokenService = require('./tokenService');

const MAIN_API_BASE = process.env.MAIN_API_URL || 'http://localhost:8091';
const PLUGIN_NAME = process.env.PLUGIN_NAME || 'user-management';

/**
 * 检查用户是否已有 refresh token，若无则生成并设置到响应头
 * @param {string} userId - 用户 ID
 * @param {import('express').Response} res - Express 响应对象
 */
async function ensureRefreshToken(userId, res) {
  try {
    const setKey = `refresh_token:${userId}`;
    const count = await redis.scard(setKey);
    if (count === 0) {
      const refreshToken = await tokenService.generateRefreshToken(userId);
      res.setHeader('X-Refresh-Token', refreshToken);
    }
  } catch (err) {
    // 生成 refresh token 失败不应阻塞正常请求
    console.error('[Auth] Failed to ensure refresh token:', err.message);
  }
}

/**
 * Express 中间件：通过主后端 API 验证 JWT Token
 * 成功后 req.user = { id, username, nickname, roles }
 * 首次认证时自动生成 refresh token 并通过 X-Refresh-Token 响应头返回
 */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先在主系统登录' });
  }

  axios.get(`${MAIN_API_BASE}/v1/plugin/verify-token`, {
    headers: { Authorization: header }
  })
    .then(async (response) => {
      if (response.data.code === 0) {
        req.user = response.data.data; // { id, username, nickname, roles }
        await ensureRefreshToken(String(req.user.id), res);
        next();
      } else {
        res.status(401).json({ error: response.data.message || '认证失败' });
      }
    })
    .catch((err) => {
      const data = err.response?.data;
      console.error('[Auth] Token verification failed:', data?.message || err.message);
      res.status(401).json({ error: data?.message || '认证失败' });
    });
}

/**
 * 权限检查中间件工厂
 * @param {string} action - 操作标识，如 'manage-users'
 */
function checkPermission(action) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    try {
      const response = await axios.get(`${MAIN_API_BASE}/v1/plugin/check-permission`, {
        headers: { Authorization: header },
        params: { plugin_name: PLUGIN_NAME, action }
      });

      if (response.data.code === 0 && response.data.data.allowed) {
        next();
      } else {
        res.status(403).json({ error: '无权限执行此操作' });
      }
    } catch (err) {
      console.error('[Auth] Permission check failed:', err.message);
      res.status(403).json({ error: '权限检查失败' });
    }
  };
}

module.exports = { auth, checkPermission, ensureRefreshToken };
