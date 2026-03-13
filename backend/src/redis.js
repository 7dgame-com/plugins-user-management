const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  db: parseInt(process.env.REDIS_DB || '1'),
  keyPrefix: 'user-mgmt:'
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

module.exports = redis;
