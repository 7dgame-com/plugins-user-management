const crypto = require('crypto');
const redis = require('./redis');

const REFRESH_TOKEN_TTL = parseInt(process.env.REFRESH_TOKEN_TTL || '604800', 10); // 7 days

/**
 * 对 token 进行 SHA-256 哈希
 * @param {string} token - 原始 token 字符串
 * @returns {string} hex 编码的哈希值
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * 生成并存储 refresh token
 * @param {string} userId - 用户 ID
 * @returns {Promise<string>} 原始 token 字符串
 */
async function generateRefreshToken(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + REFRESH_TOKEN_TTL;

  const setKey = `refresh_token:${userId}`;
  const dataKey = `refresh_token_data:${tokenHash}`;

  const pipeline = redis.pipeline();

  // 将 token hash 添加到用户的 SET 中
  pipeline.sadd(setKey, tokenHash);
  pipeline.expire(setKey, REFRESH_TOKEN_TTL);

  // 存储 token 元数据
  pipeline.hset(dataKey, 'userId', String(userId), 'createdAt', String(now), 'expiresAt', String(expiresAt));
  pipeline.expire(dataKey, REFRESH_TOKEN_TTL);

  await pipeline.exec();

  return rawToken;
}

/**
 * 验证 refresh token 的有效性
 * @param {string} token - 原始 token 字符串
 * @returns {Promise<string|null>} 有效时返回 userId，否则返回 null
 */
async function verifyRefreshToken(token) {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const dataKey = `refresh_token_data:${tokenHash}`;

  // 读取 token 元数据
  const metadata = await redis.hgetall(dataKey);
  if (!metadata || !metadata.userId) return null;

  const { userId, expiresAt } = metadata;

  // 检查 token 是否过期
  const now = Math.floor(Date.now() / 1000);
  if (now >= parseInt(expiresAt, 10)) return null;

  // 检查 token hash 是否存在于用户的 SET 中
  const isMember = await redis.sismember(`refresh_token:${userId}`, tokenHash);
  if (!isMember) return null;

  return userId;
}

/**
 * 轮换 refresh token：使旧 token 失效，生成新 token
 * @param {string} oldToken - 旧的原始 token 字符串
 * @param {string} userId - 用户 ID
 * @returns {Promise<string>} 新的原始 token 字符串
 */
async function rotateRefreshToken(oldToken, userId) {
  const oldTokenHash = hashToken(oldToken);

  const setKey = `refresh_token:${userId}`;
  const usedKey = `refresh_token_used:${oldTokenHash}`;
  const dataKey = `refresh_token_data:${oldTokenHash}`;

  const pipeline = redis.pipeline();

  // 将旧 token hash 从用户 SET 中移除
  pipeline.srem(setKey, oldTokenHash);

  // 记录旧 token 为已使用（用于重放检测），存储 userId 以便撤销
  pipeline.set(usedKey, String(userId), 'EX', REFRESH_TOKEN_TTL);

  // 清除旧 token 的元数据
  pipeline.del(dataKey);

  await pipeline.exec();

  // 生成新 token
  const newToken = await generateRefreshToken(userId);

  return newToken;
}

/**
 * 检测 token 是否已被使用过（重放攻击检测）
 * @param {string} token - 原始 token 字符串
 * @returns {Promise<boolean>} 已使用返回 true，否则返回 false
 */
async function isTokenUsed(token) {
  if (!token) return false;

  const tokenHash = hashToken(token);
  const usedKey = `refresh_token_used:${tokenHash}`;

  const exists = await redis.exists(usedKey);
  return exists === 1;
}

/**
 * 撤销用户的所有 refresh token
 * @param {string} userId - 用户 ID
 * @returns {Promise<void>}
 */
async function revokeAllUserTokens(userId) {
  const setKey = `refresh_token:${userId}`;

  // 获取该用户所有 token hash
  const tokenHashes = await redis.smembers(setKey);

  const pipeline = redis.pipeline();

  // 删除所有关联的 token 元数据键
  for (const tokenHash of tokenHashes) {
    pipeline.del(`refresh_token_data:${tokenHash}`);
  }

  // 删除用户的 token SET
  pipeline.del(setKey);

  await pipeline.exec();
}



/**
 * 获取已使用 token 关联的用户 ID（用于重放攻击时撤销用户所有 token）
 * @param {string} token - 原始 token 字符串
 * @returns {Promise<string|null>} userId 或 null
 */
async function getUserIdFromUsedToken(token) {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const usedKey = `refresh_token_used:${tokenHash}`;

  const value = await redis.get(usedKey);
  // 值为 userId 字符串（非 '1' 的旧格式）
  return value && value !== '1' ? value : null;
}

const tokenService = {
  hashToken,
  generateRefreshToken,
  verifyRefreshToken,
  rotateRefreshToken,
  isTokenUsed,
  getUserIdFromUsedToken,
  revokeAllUserTokens,
};

module.exports = tokenService;
