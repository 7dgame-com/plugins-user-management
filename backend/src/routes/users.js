const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const redis = require('../redis');
const { auth, checkPermission } = require('../auth');

const router = express.Router();
const PLUGIN_NAME = process.env.PLUGIN_NAME || 'user-management';
const CACHE_TTL = 300; // 5 minutes

// 角色优先级常量
const ROLE_PRIORITY = { root: 4, admin: 3, manager: 2, user: 1 };
const VALID_ROLES = Object.keys(ROLE_PRIORITY);

/**
 * 获取角色数组中的最高角色级别
 * @param {string[]} roles - 角色名称数组
 * @returns {number} 最高角色级别（0 表示无角色）
 */
function getRoleLevel(roles) {
  if (roles.includes('root')) return 4;
  if (roles.includes('admin')) return 3;
  if (roles.includes('manager')) return 2;
  if (roles.includes('user')) return 1;
  return 0;
}

// 获取当前登录用户信息
router.get('/me', auth, async (req, res) => {
  // req.user 已包含主后端返回的用户信息
  res.json(req.user);
});

// 获取当前用户在本插件的权限列表
router.get('/permissions', auth, async (req, res) => {
  const header = req.headers.authorization;
  try {
    const response = await require('axios').get(
      `${process.env.MAIN_API_URL || 'http://localhost:8091'}/v1/plugin/allowed-actions`,
      { headers: { Authorization: header }, params: { plugin_name: PLUGIN_NAME } }
    );
    if (response.data.code === 0) {
      const allowedActions = response.data.data.actions || [];
      const allActions = ['list-users', 'view-user', 'create-user', 'update-user', 'delete-user', 'change-role', 'manage-invitations'];
      const result = {};
      const hasWildcard = allowedActions.includes('*');
      allActions.forEach(a => { result[a] = hasWildcard || allowedActions.includes(a); });
      res.json(result);
    } else {
      res.json({ 'list-users': false, 'view-user': false, 'create-user': false, 'update-user': false, 'delete-user': false, 'change-role': false, 'manage-invitations': false });
    }
  } catch {
    res.json({ 'list-users': false, 'view-user': false, 'create-user': false, 'update-user': false, 'delete-user': false, 'change-role': false, 'manage-invitations': false });
  }
});

// 获取用户列表（分页 + 搜索 + Redis 缓存）
router.get('/', auth, checkPermission('list-users'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    const search = req.query.search || '';
    const status = req.query.status;
    const offset = (page - 1) * pageSize;

    const cacheKey = `list:${page}:${pageSize}:${search}:${status || ''}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (u.username LIKE ? OR u.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status !== undefined && status !== '') {
      where += ' AND u.status = ?';
      params.push(parseInt(status));
    }

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM user u ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.email, u.status, u.created_at, u.updated_at,
              GROUP_CONCAT(aa.item_name) as role_str
       FROM user u
       LEFT JOIN auth_assignment aa ON aa.user_id = CAST(u.id AS CHAR)
       ${where}
       GROUP BY u.id
       ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    // Parse role_str into roles array
    const data = rows.map(row => {
      const { role_str, ...user } = row;
      return { ...user, roles: role_str ? role_str.split(',') : [] };
    });

    const result = {
      data,
      pagination: {
        page,
        pageSize,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / pageSize)
      }
    };

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取单个用户
router.get('/:id', auth, checkPermission('view-user'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, status, created_at, updated_at FROM user WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // Fetch roles from auth_assignment
    const [roleRows] = await pool.query(
      'SELECT item_name FROM auth_assignment WHERE user_id = CAST(? AS CHAR)',
      [req.params.id]
    );
    const roles = roleRows.map(r => r.item_name);

    res.json({ ...rows[0], roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建用户
router.post('/', auth, checkPermission('create-user'), async (req, res) => {
  try {
    const { username, email, password, status = 10 } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const [existing] = await pool.query('SELECT id FROM user WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    // bcrypt cost=12，与主系统 Yii2 一致
    const passwordHash = await bcrypt.hash(password, 12);
    const now = Math.floor(Date.now() / 1000);
    const authKey = require('crypto').randomBytes(32).toString('hex');

    const [result] = await pool.query(
      'INSERT INTO user (username, email, password_hash, auth_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [username, email || '', passwordHash, authKey, status, now, now]
    );

    await clearListCache();

    const [newUser] = await pool.query(
      'SELECT id, username, email, status, created_at, updated_at FROM user WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(newUser[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新用户
router.put('/:id', auth, checkPermission('update-user'), async (req, res) => {
  try {
    const { username, email, status, password } = req.body;
    const updates = [];
    const params = [];

    if (username !== undefined) { updates.push('username = ?'); params.push(username); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      updates.push('password_hash = ?');
      params.push(hash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }

    updates.push('updated_at = ?');
    params.push(Math.floor(Date.now() / 1000));
    params.push(req.params.id);

    await pool.query(`UPDATE user SET ${updates.join(', ')} WHERE id = ?`, params);
    await clearListCache();

    const [rows] = await pool.query(
      'SELECT id, username, email, status, created_at, updated_at FROM user WHERE id = ?',
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除用户
router.delete('/:id', auth, checkPermission('delete-user'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM user WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    await clearListCache();
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function clearListCache() {
  const keys = await redis.keys('user-mgmt:list:*');
  if (keys.length > 0) {
    const rawKeys = keys.map(k => k.replace('user-mgmt:', ''));
    await redis.del(...rawKeys);
  }
}

// 修改用户角色（权限层级约束）
router.put('/:id/role', auth, checkPermission('change-role'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { role } = req.body;
    const targetId = req.params.id;

    // 验证新角色是否有效
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `无效的角色，有效值: ${VALID_ROLES.join(', ')}` });
    }

    // 获取操作者角色级别
    const operatorLevel = getRoleLevel(req.user.roles || []);

    // 获取目标用户信息及当前角色
    const [targetRows] = await conn.query(
      'SELECT id, username, email, status, created_at, updated_at FROM user WHERE id = ?',
      [targetId]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const [targetRoleRows] = await conn.query(
      'SELECT item_name FROM auth_assignment WHERE user_id = CAST(? AS CHAR)',
      [targetId]
    );
    const targetRoles = targetRoleRows.map(r => r.item_name);
    const targetLevel = getRoleLevel(targetRoles);

    // 新角色级别
    const newLevel = ROLE_PRIORITY[role];

    // 层级约束校验：操作者级别必须 >= 目标用户级别 且 >= 新角色级别
    if (targetLevel > operatorLevel) {
      return res.status(403).json({ error: '不能修改比自己角色级别高的用户' });
    }
    if (newLevel > operatorLevel) {
      return res.status(403).json({ error: '不能赋予高于自己角色级别的角色' });
    }

    // 事务操作：DELETE 旧角色 → INSERT 新角色
    await conn.beginTransaction();
    try {
      await conn.query(
        'DELETE FROM auth_assignment WHERE user_id = CAST(? AS CHAR)',
        [targetId]
      );
      const now = Math.floor(Date.now() / 1000);
      await conn.query(
        'INSERT INTO auth_assignment (item_name, user_id, created_at) VALUES (?, CAST(? AS CHAR), ?)',
        [role, targetId, now]
      );
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    }

    console.log(`[Role] User ${req.user.id} changed user ${targetId} role from [${targetRoles.join(',')}] to [${role}]`);

    // 清除列表缓存
    await clearListCache();

    // 返回更新后的用户信息
    res.json({ ...targetRows[0], roles: [role] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});


module.exports = router;
