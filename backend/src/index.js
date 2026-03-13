const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const redis = require('./redis');
const userRoutes = require('./routes/users');
const { invitationRouter, registerRouter } = require('./routes/invitations');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 8086;

app.use(cors({
  origin: ['http://localhost:3003', 'http://localhost:3001', 'http://localhost:8080'],
  credentials: true
}));
app.use(express.json());

// 健康检查（带版本号，方便验证部署）
const APP_VERSION = '2.0.0'; // v2: 使用主后端 Plugin Auth API
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok', version: APP_VERSION, db: 'connected', redis: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', version: APP_VERSION, message: err.message });
  }
});

app.use('/api/users', userRoutes);
app.use('/api/invitations', invitationRouter);
app.use('/api/register', registerRouter);
app.use('/api/auth', authRoutes);

app.listen(PORT, () => {
  console.log(`[User Management] API running on port ${PORT}`);
});
