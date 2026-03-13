/**
 * 密码校验模块 — 与主系统策略一致
 * 规则：≥12 字符，同时包含大写字母、小写字母、数字、特殊字符
 */

/**
 * 校验密码是否满足复杂性要求
 * @param {string} password
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePassword(password) {
  const errors = [];

  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['密码不能为空'] };
  }

  if (password.length < 12) {
    errors.push('密码长度至少 12 个字符');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('密码必须包含大写字母');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('密码必须包含小写字母');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('密码必须包含数字');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('密码必须包含特殊字符');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validatePassword };
