const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const db = new sqlite3.Database(path.join(__dirname, 'trackit.db'));

app.use(cors());
app.use(express.json());

const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const captchaStore = new Map();

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onDone(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
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
      schedule_type TEXT NOT NULL DEFAULT 'daily',
      days_of_week TEXT DEFAULT '',
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

  await run("ALTER TABLE habits ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'daily'").catch(() => {});
  await run("ALTER TABLE habits ADD COLUMN days_of_week TEXT DEFAULT ''").catch(() => {});
  await run("ALTER TABLE habit_entries ADD COLUMN notes TEXT DEFAULT ''").catch(() => {});
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isYm(value) {
  return /^\d{4}-\d{2}$/.test(value);
}

function formatDateYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDaysCsv(csv) {
  if (!csv) return [];
  return csv
    .split(',')
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);
}

function normalizeSchedule(scheduleType, daysOfWeek) {
  let type = scheduleType;
  if (type !== 'daily' && type !== 'weekly' && type !== 'specific_days') {
    type = 'daily';
  }

  let days = '';
  if (type === 'specific_days') {
    const arr = Array.isArray(daysOfWeek) ? daysOfWeek : [];
    const parsed = [...new Set(arr.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))]
      .sort((a, b) => a - b);
    if (parsed.length === 0) {
      return { error: 'daysOfWeek is required for specific_days schedule' };
    }
    days = parsed.join(',');
  }

  return { scheduleType: type, daysOfWeekCsv: days };
}

function isHabitDueOnDate(habit, targetDate) {
  if (habit.schedule_type === 'weekly') {
    const createdDate = new Date(habit.created_at);
    if (Number.isNaN(createdDate.getTime())) return false;
    return createdDate.getDay() === targetDate.getDay();
  }

  if (habit.schedule_type === 'specific_days') {
    const days = parseDaysCsv(habit.days_of_week);
    return days.includes(targetDate.getDay());
  }

  return true;
}

function cleanupCaptchaStore() {
  const now = Date.now();
  for (const [id, item] of captchaStore.entries()) {
    if (item.expiresAt <= now) captchaStore.delete(id);
  }
}

function createCaptcha() {
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  const captchaId = crypto.randomBytes(16).toString('hex');
  captchaStore.set(captchaId, { answer: String(a + b), expiresAt: Date.now() + CAPTCHA_TTL_MS });
  return { captchaId, question: `${a} + ${b} = ?` };
}

function checkCaptcha(captchaId, captchaAnswer) {
  if (!captchaId || typeof captchaAnswer !== 'string') return { ok: false, error: 'Captcha is required' };

  const item = captchaStore.get(captchaId);
  if (!item) return { ok: false, error: 'Invalid captcha. Please refresh and try again' };

  captchaStore.delete(captchaId);

  if (Date.now() > item.expiresAt) {
    return { ok: false, error: 'Captcha expired. Please refresh and try again' };
  }

  if (item.answer !== captchaAnswer.trim()) {
    return { ok: false, error: 'Incorrect captcha answer' };
  }

  return { ok: true };
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function getDueHabitsForDate(userId, dateStr) {
  const targetDate = new Date(`${dateStr}T00:00:00`);
  const habits = await all(
    'SELECT id, name, schedule_type, days_of_week, created_at FROM habits WHERE user_id = ? ORDER BY id DESC',
    [userId]
  );

  const entries = await all(
    `
    SELECT e.habit_id, e.completed, COALESCE(e.notes, '') AS notes
    FROM habit_entries e
    JOIN habits h ON h.id = e.habit_id
    WHERE h.user_id = ? AND e.entry_date = ?
    `,
    [userId, dateStr]
  );

  const entryMap = new Map();
  for (const e of entries) entryMap.set(e.habit_id, e);

  const result = [];
  for (const habit of habits) {
    if (!isHabitDueOnDate(habit, targetDate)) continue;
    const entry = entryMap.get(habit.id);
    result.push({
      habitId: habit.id,
      name: habit.name,
      scheduleType: habit.schedule_type,
      daysOfWeek: habit.days_of_week || '',
      completed: entry ? Number(entry.completed) : 0,
      notes: entry ? entry.notes : '',
    });
  }

  return result;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/captcha', (_req, res) => {
  cleanupCaptchaStore();
  res.json(createCaptcha());
});

app.post('/api/register', async (req, res) => {
  try {
    const { email, password, captchaId, captchaAnswer } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const captcha = checkCaptcha(captchaId, captchaAnswer);
    if (!captcha.ok) {
      return res.status(400).json({ error: captcha.error });
    }

    const existing = await get('SELECT id FROM users WHERE email = ?', [String(email).toLowerCase()]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(String(password), 10);
    const result = await run('INSERT INTO users (email, password_hash) VALUES (?, ?)', [
      String(email).toLowerCase(),
      hash,
    ]);

    const token = jwt.sign({ userId: result.lastID, email: String(email).toLowerCase() }, JWT_SECRET, {
      expiresIn: '7d',
    });

    return res.status(201).json({ token });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password, captchaId, captchaAnswer } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const captcha = checkCaptcha(captchaId, captchaAnswer);
    if (!captcha.ok) {
      return res.status(400).json({ error: captcha.error });
    }

    const user = await get('SELECT id, email, password_hash FROM users WHERE email = ?', [
      String(email).toLowerCase(),
    ]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/habits', auth, async (req, res) => {
  try {
    const rows = await all(
      'SELECT id, name, schedule_type AS scheduleType, days_of_week AS daysOfWeek FROM habits WHERE user_id = ? ORDER BY id DESC',
      [req.user.userId]
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/habits', auth, async (req, res) => {
  try {
    const { name, scheduleType, daysOfWeek } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Habit name required' });
    }

    const schedule = normalizeSchedule(scheduleType, daysOfWeek);
    if (schedule.error) {
      return res.status(400).json({ error: schedule.error });
    }

    const result = await run(
      'INSERT INTO habits (user_id, name, schedule_type, days_of_week) VALUES (?, ?, ?, ?)',
      [req.user.userId, String(name).trim(), schedule.scheduleType, schedule.daysOfWeekCsv]
    );

    return res.status(201).json({
      id: result.lastID,
      name: String(name).trim(),
      scheduleType: schedule.scheduleType,
      daysOfWeek: schedule.daysOfWeekCsv,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/habits/:id', auth, async (req, res) => {
  try {
    const habitId = Number(req.params.id);
    const { name, scheduleType, daysOfWeek } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Habit name required' });
    }

    const existing = await get(
      'SELECT id, schedule_type AS scheduleType, days_of_week AS daysOfWeek FROM habits WHERE id = ? AND user_id = ?',
      [habitId, req.user.userId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const schedule = normalizeSchedule(
      scheduleType || existing.scheduleType,
      daysOfWeek !== undefined ? daysOfWeek : String(existing.daysOfWeek || '').split(',').filter(Boolean)
    );
    if (schedule.error) {
      return res.status(400).json({ error: schedule.error });
    }

    await run(
      'UPDATE habits SET name = ?, schedule_type = ?, days_of_week = ? WHERE id = ? AND user_id = ?',
      [String(name).trim(), schedule.scheduleType, schedule.daysOfWeekCsv, habitId, req.user.userId]
    );

    return res.json({
      id: habitId,
      name: String(name).trim(),
      scheduleType: schedule.scheduleType,
      daysOfWeek: schedule.daysOfWeekCsv,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/habits/:id', auth, async (req, res) => {
  try {
    const habitId = Number(req.params.id);

    await run('DELETE FROM habit_entries WHERE habit_id = ?', [habitId]);
    const result = await run('DELETE FROM habits WHERE id = ? AND user_id = ?', [habitId, req.user.userId]);

    if (!result.changes) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/entries/today', auth, async (req, res) => {
  try {
    const today = formatDateYmd(new Date());
    const habits = await getDueHabitsForDate(req.user.userId, today);
    return res.json({ date: today, habits });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/entries/day', auth, async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (!isYmd(date)) {
      return res.status(400).json({ error: 'date query param is required (YYYY-MM-DD)' });
    }

    const habits = await getDueHabitsForDate(req.user.userId, date);
    return res.json({ date, habits });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/entries/month', auth, async (req, res) => {
  try {
    const month = String(req.query.month || '');
    if (!isYm(month)) {
      return res.status(400).json({ error: 'month query param is required (YYYY-MM)' });
    }

    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;

    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);

    const habits = await all(
      'SELECT id, schedule_type, days_of_week, created_at FROM habits WHERE user_id = ?',
      [req.user.userId]
    );

    const startYmd = formatDateYmd(firstDay);
    const endYmd = formatDateYmd(lastDay);

    const entries = await all(
      `
      SELECT e.habit_id, e.entry_date, e.completed
      FROM habit_entries e
      JOIN habits h ON h.id = e.habit_id
      WHERE h.user_id = ? AND e.entry_date >= ? AND e.entry_date <= ?
      `,
      [req.user.userId, startYmd, endYmd]
    );

    const entryMap = new Map();
    for (const item of entries) {
      entryMap.set(`${item.entry_date}::${item.habit_id}`, Number(item.completed));
    }

    const days = [];
    for (let d = 1; d <= lastDay.getDate(); d += 1) {
      const current = new Date(year, monthIndex, d);
      const date = formatDateYmd(current);

      let totalHabits = 0;
      let completedHabits = 0;

      for (const habit of habits) {
        if (!isHabitDueOnDate(habit, current)) continue;
        totalHabits += 1;
        if (entryMap.get(`${date}::${habit.id}`) === 1) {
          completedHabits += 1;
        }
      }

      let status = 'none';
      if (totalHabits > 0) {
        status = completedHabits === totalHabits ? 'green' : 'red';
      }

      days.push({ date, status, totalHabits, completedHabits });
    }

    return res.json({ month, days });
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

    const habit = await get('SELECT id FROM habits WHERE id = ? AND user_id = ?', [habitId, req.user.userId]);
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const today = formatDateYmd(new Date());

    if (typeof notes === 'string') {
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
