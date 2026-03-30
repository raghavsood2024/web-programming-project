const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const dbPath = path.join(__dirname, 'habit-tracker.db');
const db = new sqlite3.Database(dbPath);

app.use(cors());
app.use(express.json());

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS habit_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER NOT NULL,
      entry_date TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      UNIQUE(habit_id, entry_date),
      FOREIGN KEY(habit_id) REFERENCES habits(id)
    )
  `);

  const habitEntryColumns = await all('PRAGMA table_info(habit_entries)');
  const hasNotes = habitEntryColumns.some((col) => col.name === 'notes');
  if (!hasNotes) {
    await run("ALTER TABLE habit_entries ADD COLUMN notes TEXT DEFAULT ''");
  }
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Valid email and password (min 6 chars) required' });
    }

    const existing = await get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await run('INSERT INTO users (email, password_hash) VALUES (?, ?)', [
      email.toLowerCase(),
      passwordHash,
    ]);

    const token = jwt.sign({ userId: result.lastID, email: email.toLowerCase() }, JWT_SECRET, {
      expiresIn: '7d',
    });

    return res.status(201).json({ token });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await get('SELECT id, email, password_hash FROM users WHERE email = ?', [
      email.toLowerCase(),
    ]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: '7d',
    });

    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/habits', auth, async (req, res) => {
  try {
    const habits = await all('SELECT id, name FROM habits WHERE user_id = ? ORDER BY id DESC', [
      req.user.userId,
    ]);
    return res.json(habits);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/habits', auth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Habit name required' });
    }

    const result = await run('INSERT INTO habits (user_id, name) VALUES (?, ?)', [
      req.user.userId,
      name.trim(),
    ]);

    return res.status(201).json({ id: result.lastID, name: name.trim() });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/habits/:id', auth, async (req, res) => {
  try {
    const habitId = Number(req.params.id);
    const { name } = req.body;

    if (!Number.isInteger(habitId) || habitId <= 0) {
      return res.status(400).json({ error: 'Invalid habit id' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Habit name required' });
    }

    const habit = await get('SELECT id FROM habits WHERE id = ? AND user_id = ?', [
      habitId,
      req.user.userId,
    ]);
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const nextName = name.trim();
    await run('UPDATE habits SET name = ? WHERE id = ? AND user_id = ?', [
      nextName,
      habitId,
      req.user.userId,
    ]);

    return res.json({ id: habitId, name: nextName });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/habits/:id', auth, async (req, res) => {
  try {
    const habitId = Number(req.params.id);
    if (!Number.isInteger(habitId) || habitId <= 0) {
      return res.status(400).json({ error: 'Invalid habit id' });
    }

    const habit = await get('SELECT id FROM habits WHERE id = ? AND user_id = ?', [
      habitId,
      req.user.userId,
    ]);
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    await run('DELETE FROM habit_entries WHERE habit_id = ?', [habitId]);
    await run('DELETE FROM habits WHERE id = ? AND user_id = ?', [habitId, req.user.userId]);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/entries/today', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await all(
      `
      SELECT h.id AS habitId, h.name, COALESCE(e.completed, 0) AS completed, COALESCE(e.notes, '') AS notes
      FROM habits h
      LEFT JOIN habit_entries e
        ON e.habit_id = h.id
       AND e.entry_date = ?
      WHERE h.user_id = ?
      ORDER BY h.id DESC
      `,
      [today, req.user.userId]
    );

    return res.json({ date: today, habits: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/entries/today', auth, async (req, res) => {
  try {
    const { habitId, completed, notes } = req.body;
    if (!habitId || typeof completed !== 'boolean') {
      return res.status(400).json({ error: 'habitId and completed(boolean) are required' });
    }
    const hasNotes = typeof notes === 'string';
    if (hasNotes && notes.length > 500) {
      return res.status(400).json({ error: 'Notes must be 500 characters or fewer' });
    }

    const habit = await get('SELECT id FROM habits WHERE id = ? AND user_id = ?', [
      habitId,
      req.user.userId,
    ]);
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const today = new Date().toISOString().slice(0, 10);
    if (hasNotes) {
      await run(
        `
        INSERT INTO habit_entries (habit_id, entry_date, completed, notes)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(habit_id, entry_date)
        DO UPDATE SET completed = excluded.completed, notes = excluded.notes
        `,
        [habitId, today, completed ? 1 : 0, notes]
      );
    } else {
      await run(
        `
        INSERT INTO habit_entries (habit_id, entry_date, completed)
        VALUES (?, ?, ?)
        ON CONFLICT(habit_id, entry_date)
        DO UPDATE SET completed = excluded.completed
        `,
        [habitId, today, completed ? 1 : 0]
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
