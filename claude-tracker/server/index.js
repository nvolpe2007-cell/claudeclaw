const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Create or update a user profile (upsert)
app.post('/api/users', (req, res) => {
  const { id, name } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'id and name are required' });
  }

  const upsert = db.prepare(`
    INSERT INTO users (id, name)
    VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name
  `);
  upsert.run(id, name);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json(user);
});

// Save a completed session
app.post('/api/sessions', (req, res) => {
  const { userId, durationSeconds } = req.body;

  if (!userId || !durationSeconds || durationSeconds <= 0) {
    return res.status(400).json({ error: 'userId and a positive durationSeconds are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'user not found' });
  }

  const now = new Date();
  const startedAt = new Date(now.getTime() - durationSeconds * 1000).toISOString();
  const endedAt = now.toISOString();

  const insert = db.prepare(`
    INSERT INTO sessions (user_id, duration_seconds, started_at, ended_at)
    VALUES (?, ?, ?, ?)
  `);
  const result = insert.run(userId, Math.round(durationSeconds), startedAt, endedAt);

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(session);
});

// Leaderboard: all users sorted by total_seconds desc
app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id,
      u.name,
      u.created_at,
      COALESCE(SUM(s.duration_seconds), 0) AS total_seconds,
      COUNT(s.id) AS session_count
    FROM users u
    LEFT JOIN sessions s ON s.user_id = u.id
    GROUP BY u.id
    ORDER BY total_seconds DESC
  `).all();

  res.json(rows);
});

// Single user's stats
app.get('/api/user/:userId', (req, res) => {
  const { userId } = req.params;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'user not found' });
  }

  const stats = db.prepare(`
    SELECT
      COALESCE(SUM(duration_seconds), 0) AS total_seconds,
      COUNT(id) AS session_count
    FROM sessions
    WHERE user_id = ?
  `).get(userId);

  res.json({
    id: user.id,
    name: user.name,
    created_at: user.created_at,
    total_seconds: stats.total_seconds,
    session_count: stats.session_count,
  });
});

app.listen(PORT, () => {
  console.log(`Claude Tracker API listening on http://localhost:${PORT}`);
});
