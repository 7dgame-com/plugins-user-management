const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const redis = require('../redis');
const { auth, checkPermission } = require('../auth');
const { validatePassword } = require('../password');

const router = express.Router();
const registerRouter = express.Router();

const MAIN_API_BASE = process.env.MAIN_API_URL || 'http://localhost:8091';
const MAIN_API_SERVICE_TOKEN = process.env.MAIN_API_SERVICE_TOKEN || '';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3003';
const DEFAULT_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * POST / — 生成邀请码
 * Body: { quota: number, expiresIn?: number (seconds), note?: string }
 * Auth: required + manage-invitations
 */
router.post('/', auth, checkPermission('manage-invitations'), async (req, res) => {
  try {
    const { quota, expiresIn, note } = req.body;

    if (!quota || !Number.isInteger(quota) || quota < 1) {
      return res.status(400).json({ error: '可注册人数必须为正整数' });
    }

    const ttl = (expiresIn && Number.isInteger(expiresIn) && expiresIn > 0)
      ? expiresIn
      : DEFAULT_EXPIRY;

    const code = crypto.randomBytes(4).toString('hex'); // 8-char hex
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const key = `invite:${code}`;

    const createdAt = Math.floor(Date.now() / 1000);

    await redis.hmset(key, {
      quota: String(quota),
      remaining: String(quota),
      expiresAt: String(expiresAt),
      creatorId: String(req.user.id),
      creatorName: req.user.nickname || req.user.username || '',
      note: note || '',
      createdAt: String(createdAt)
    });
    await redis.expire(key, ttl);

    const inviteUrl = `${FRONTEND_URL}/register?invite=${code}`;

    res.status(201).json({
      code,
      url: inviteUrl,
      quota,
      remaining: quota,
      expiresAt,
      creatorId: req.user.id,
      creatorName: req.user.nickname || req.user.username || '',
      note: note || '',
      createdAt
    });
  } catch (err) {
    console.error('[Invitations] POST / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/**
 * GET / — 获取所有邀请列表
 * Auth: required + manage-invitations
 */
router.get('/', auth, checkPermission('manage-invitations'), async (req, res) => {
  try {
    console.log('[Invitations] GET / — user:', req.user?.id, 'roles:', req.user?.roles);
    // Use SCAN to iterate invite keys
    // ioredis scanStream with keyPrefix: the match pattern is sent as-is to Redis SCAN.
    // Returned keys do NOT include the keyPrefix (ioredis strips it).
    // So we match the full Redis key pattern and strip prefix from results.
    const keys = [];
    const stream = redis.scanStream({ match: 'user-mgmt:invite:*', count: 100 });

    await new Promise((resolve, reject) => {
      stream.on('data', (batch) => {
        console.log('[Invitations] scanStream batch:', batch);
        for (const k of batch) {
          keys.push(k.replace('user-mgmt:', ''));
        }
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    console.log('[Invitations] Found keys after strip:', keys);

    if (keys.length === 0) {
      return res.json([]);
    }

    const now = Math.floor(Date.now() / 1000);
    const invitations = [];

    for (const rawKey of keys) {
      const data = await redis.hgetall(rawKey);
      console.log('[Invitations] hgetall(' + rawKey + ') =>', JSON.stringify(data));
      if (!data || !data.quota) continue;

      const code = rawKey.replace('invite:', '');
      const remaining = parseInt(data.remaining) || 0;
      const expiresAt = parseInt(data.expiresAt) || 0;

      let status = 'active';
      if (expiresAt <= now) {
        status = 'expired';
      } else if (remaining <= 0) {
        status = 'used_up';
      }

      invitations.push({
        code,
        quota: parseInt(data.quota) || 0,
        remaining,
        expiresAt,
        creatorId: data.creatorId || '',
        creatorName: data.creatorName || '',
        note: data.note || '',
        createdAt: parseInt(data.createdAt) || 0,
        status
      });
    }

    // Sort by createdAt descending (newest first)
    invitations.sort((a, b) => b.createdAt - a.createdAt);

    res.json(invitations);
  } catch (err) {
    console.error('[Invitations] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /:code — 撤销邀请
 * Auth: required + manage-invitations
 */
router.delete('/:code', auth, checkPermission('manage-invitations'), async (req, res) => {
  try {
    const key = `invite:${req.params.code}`;
    const exists = await redis.exists(key);
    if (!exists) {
      return res.status(404).json({ error: '邀请码不存在或已过期' });
    }

    await redis.del(key);
    res.json({ message: '邀请已撤销' });
  } catch (err) {
    console.error('[Invitations] DELETE /:code error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:code/check — 验证邀请码有效性（公开端点，无需认证）
 */
router.get('/:code/check', async (req, res) => {
  try {
    const key = `invite:${req.params.code}`;
    const data = await redis.hgetall(key);

    if (!data || !data.quota) {
      return res.json({ valid: false, reason: '邀请码不存在或已过期' });
    }

    const now = Math.floor(Date.now() / 1000);
    const remaining = parseInt(data.remaining) || 0;
    const expiresAt = parseInt(data.expiresAt) || 0;

    if (expiresAt <= now) {
      return res.json({ valid: false, reason: '邀请码已过期' });
    }

    if (remaining <= 0) {
      return res.json({ valid: false, reason: '邀请名额已用完' });
    }

    res.json({ valid: true, remaining, expiresAt });
  } catch (err) {
    console.error('[Invitations] GET /:code/check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:code/records — 查询该邀请码的注册用户列表
 * Auth: required + manage-invitations
 */
router.get('/:code/records', auth, checkPermission('manage-invitations'), async (req, res) => {
  try {
    const code = req.params.code;

    const [rows] = await pool.query(
      `SELECT ir.id, ir.invite_code, ir.inviter_id, ir.invitee_id, ir.created_at,
              u.username, u.email
       FROM invitation_record ir
       JOIN user u ON u.id = ir.invitee_id
       WHERE ir.invite_code = ?
       ORDER BY ir.created_at DESC`,
      [code]
    );

    res.json(rows);
  } catch (err) {
    console.error('[Invitations] GET /:code/records error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 公开注册端点（无需认证）
// ============================================================

/**
 * POST /api/register/send-code — 发送邮箱验证码（公开端点）
 * Body: { inviteCode: string, email: string }
 *
 * 流程：验证邀请码 → 检查邮箱未注册 → 生成验证码存 Redis → 调用主后端发送邮件
 */
registerRouter.post('/send-code', async (req, res) => {
  try {
    const { inviteCode, email } = req.body;

    // 1. 参数校验
    if (!inviteCode || !email) {
      return res.status(400).json({ error: '邀请码和邮箱不能为空' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '邮箱格式无效' });
    }

    // 2. 验证邀请码有效性
    const inviteKey = `invite:${inviteCode}`;
    const inviteData = await redis.hgetall(inviteKey);
    if (!inviteData || !inviteData.quota) {
      return res.status(400).json({ error: '邀请码不存在或已过期' });
    }
    const now = Math.floor(Date.now() / 1000);
    if (parseInt(inviteData.expiresAt) <= now) {
      return res.status(400).json({ error: '邀请码已过期' });
    }
    if (parseInt(inviteData.remaining) <= 0) {
      return res.status(400).json({ error: '邀请名额已用完' });
    }

    // 3. 检查邮箱是否已注册
    const [existingEmail] = await pool.query(
      'SELECT id FROM user WHERE email = ?',
      [email.toLowerCase().trim()]
    );
    if (existingEmail.length > 0) {
      return res.status(409).json({ error: '该邮箱已注册' });
    }

    // 4. 速率限制：同一邮箱 60 秒内只能发送 1 次
    const rateLimitKey = `register:rate:${email.toLowerCase().trim()}`;
    const rateExists = await redis.exists(rateLimitKey);
    if (rateExists) {
      const ttl = await redis.ttl(rateLimitKey);
      return res.status(429).json({ error: `发送过于频繁，请 ${ttl} 秒后再试` });
    }

    // 5. 生成 6 位验证码并存储到 Redis（15 分钟过期）
    const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const codeKey = `register:code:${email.toLowerCase().trim()}`;
    await redis.setex(codeKey, 900, JSON.stringify({ code, created_at: now }));

    // 6. 设置速率限制（60 秒）
    await redis.setex(rateLimitKey, 60, '1');

    // 7. 调用主后端发送邮件
    if (!MAIN_API_SERVICE_TOKEN) {
      console.warn('[Register] MAIN_API_SERVICE_TOKEN not configured, verification code:', code);
      return res.json({ message: '验证码已生成（邮件服务未配置，请查看后端日志）' });
    }

    try {
      await axios.post(`${MAIN_API_BASE}/v1/plugin/send-email`, {
        email: email.toLowerCase().trim(),
        type: 'verification_code',
        params: {}
      }, {
        headers: { Authorization: `Bearer ${MAIN_API_SERVICE_TOKEN}` }
      });
    } catch (emailErr) {
      // 邮件发送失败不阻塞流程，验证码已存储
      console.error('[Register] Failed to send email via main backend:', emailErr.response?.data || emailErr.message);
      // 注意：主后端也会生成自己的验证码存到 DB 0，但我们用自己 DB 1 的
      // 如果主后端发送失败，验证码仍然有效（开发环境可从日志获取）
      return res.status(500).json({ error: '邮件发送失败，请稍后重试' });
    }

    res.json({ message: '验证码已发送到您的邮箱' });
  } catch (err) {
    console.error('[Register] POST /send-code error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/register — 通过邀请码注册（公开端点）
 * Body: { inviteCode, username, password, email, verificationCode }
 *
 * 流程：验证邀请码 → 验证邮箱验证码 → 密码校验 → 用户名唯一性 →
 *       Redis 原子递减名额 → 事务 INSERT user + auth_assignment + invitation_record → 清验证码
 */
registerRouter.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { inviteCode, username, password, email, verificationCode } = req.body;

    // 1. 参数校验
    if (!inviteCode || !username || !password || !email || !verificationCode) {
      return res.status(400).json({ error: '所有字段均为必填' });
    }

    // 2. 验证邀请码有效性
    const inviteKey = `invite:${inviteCode}`;
    const inviteData = await redis.hgetall(inviteKey);
    if (!inviteData || !inviteData.quota) {
      return res.status(400).json({ error: '邀请码不存在或已过期' });
    }
    const now = Math.floor(Date.now() / 1000);
    if (parseInt(inviteData.expiresAt) <= now) {
      return res.status(400).json({ error: '邀请码已过期' });
    }
    if (parseInt(inviteData.remaining) <= 0) {
      return res.status(400).json({ error: '邀请名额已用完' });
    }

    // 3. 验证邮箱验证码
    const codeKey = `register:code:${email.toLowerCase().trim()}`;
    const codeData = await redis.get(codeKey);
    if (!codeData) {
      return res.status(400).json({ error: '验证码已过期或未发送，请重新获取' });
    }
    const parsed = JSON.parse(codeData);
    if (parsed.code !== verificationCode) {
      return res.status(400).json({ error: '邮箱验证码不正确' });
    }

    // 4. 密码复杂性校验
    const pwResult = validatePassword(password);
    if (!pwResult.valid) {
      return res.status(400).json({ error: '密码不符合要求', details: pwResult.errors });
    }

    // 5. 用户名唯一性检查
    const [existingUser] = await pool.query(
      'SELECT id FROM user WHERE username = ?', [username]
    );
    if (existingUser.length > 0) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    // 6. 邮箱唯一性检查
    const [existingEmail] = await pool.query(
      'SELECT id FROM user WHERE email = ?', [email.toLowerCase().trim()]
    );
    if (existingEmail.length > 0) {
      return res.status(409).json({ error: '该邮箱已注册' });
    }

    // 7. Redis 原子递减名额（HINCRBY -1，检查结果）
    const newRemaining = await redis.hincrby(inviteKey, 'remaining', -1);
    if (newRemaining < 0) {
      // 名额已用完，回滚递减
      await redis.hincrby(inviteKey, 'remaining', 1);
      return res.status(400).json({ error: '邀请名额已用完' });
    }

    // 8. 事务：INSERT user + auth_assignment + invitation_record
    const passwordHash = await bcrypt.hash(password, 12);
    const authKey = crypto.randomBytes(32).toString('hex');

    await conn.beginTransaction();
    try {
      // 插入用户
      const [userResult] = await conn.query(
        `INSERT INTO user (username, email, password_hash, auth_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 10, ?, ?)`,
        [username, email.toLowerCase().trim(), passwordHash, authKey, now, now]
      );
      const newUserId = userResult.insertId;

      // 分配默认角色 user
      await conn.query(
        `INSERT INTO auth_assignment (item_name, user_id, created_at)
         VALUES ('user', CAST(? AS CHAR), ?)`,
        [newUserId, now]
      );

      // 写入邀请记录
      await conn.query(
        `INSERT INTO invitation_record (invite_code, inviter_id, invitee_id, created_at)
         VALUES (?, ?, ?, ?)`,
        [inviteCode, parseInt(inviteData.creatorId), newUserId, now]
      );

      await conn.commit();

      // 9. 清除验证码
      await redis.del(codeKey);

      console.log(`[Register] User ${username} (id=${newUserId}) registered via invite ${inviteCode}`);

      res.status(201).json({
        message: '注册成功',
        user: {
          id: newUserId,
          username,
          email: email.toLowerCase().trim(),
          roles: ['user']
        }
      });
    } catch (txErr) {
      await conn.rollback();
      // 回滚 Redis 名额
      await redis.hincrby(inviteKey, 'remaining', 1);
      throw txErr;
    }
  } catch (err) {
    console.error('[Register] POST / error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  } finally {
    conn.release();
  }
});

module.exports = { invitationRouter: router, registerRouter };
