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

  const habitEntryColumns = await all('PRAGMA table_info(habit_entries)');
  const hasNotes = habitEntryColumns.some((col) => col.name === 'notes');
  if (!hasNotes) {
    await run("ALTER TABLE habit_entries ADD COLUMN notes TEXT DEFAULT ''");
  }

  const habitColumns = await all('PRAGMA table_info(habits)');
  const hasScheduleType = habitColumns.some((col) => col.name === 'schedule_type');
  if (!hasScheduleType) {
    await run("ALTER TABLE habits ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'daily'");
  }
  const hasDaysOfWeek = habitColumns.some((col) => col.name === 'days_of_week');
  if (!hasDaysOfWeek) {
    await run("ALTER TABLE habits ADD COLUMN days_of_week TEXT DEFAULT ''");
  }
}

function parseScheduleInput(scheduleType, daysOfWeek) {
  const allowed = ['daily', 'weekly', 'specific_days'];
  const nextScheduleType = scheduleType || 'daily';
  if (!allowed.includes(nextScheduleType)) {
    return { error: 'scheduleType must be daily, weekly, or specific_days' };
  }

  if (nextScheduleType === 'specific_days') {
    if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
      return { error: 'daysOfWeek is required for specific_days schedule' };
    }

    const parsed = [...new Set(daysOfWeek.map((d) => Number(d)))].sort((a, b) => a - b);
    const invalid = parsed.some((d) => !Number.isInteger(d) || d < 0 || d > 6);
    if (invalid) {
      return { error: 'daysOfWeek must contain integers 0-6' };
    }
    return { scheduleType: nextScheduleType, daysOfWeekCsv: parsed.join(',') };
  }

  return { scheduleType: nextScheduleType, daysOfWeekCsv: '' };
}

function parseDateYmd(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatDateYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDaysCsv(daysCsv) {
  if (!daysCsv) return [];
  return daysCsv
    .split(',')
    .filter((v) => v !== '')
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6);
}

function isHabitDueOnDate(habit, targetDate) {
  const createdDate = new Date(habit.created_at);
  if (!Number.isNaN(createdDate.getTime())) {
    const createdYmd = formatDateYmd(createdDate);
    const targetYmd = formatDateYmd(targetDate);
    if (targetYmd < createdYmd) return false;
  }

  if (habit.schedule_type === 'weekly') {
    if (Number.isNaN(createdDate.getTime())) return false;
    return targetDate.getDay() === createdDate.getDay();
  }

  if (habit.schedule_type === 'specific_days') {
    const days = parseDaysCsv(habit.days_of_week);
    return days.includes(targetDate.getDay());
  }

  return true;
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
    const habits = await all(
      'SELECT id, name, schedule_type AS scheduleType, days_of_week AS daysOfWeek FROM habits WHERE user_id = ? ORDER BY id DESC',
      [req.user.userId]
    );
    return res.json(habits);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/habits', auth, async (req, res) => {
  try {
    const { name, scheduleType, daysOfWeek } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Habit name required' });
    }

    const schedule = parseScheduleInput(scheduleType, daysOfWeek);
    if (schedule.error) {
      return res.status(400).json({ error: schedule.error });
    }

    const result = await run(
      'INSERT INTO habits (user_id, name, schedule_type, days_of_week) VALUES (?, ?, ?, ?)',
      [
        req.user.userId,
        name.trim(),
        schedule.scheduleType,
        schedule.daysOfWeekCsv,
      ]
    );

    return res.status(201).json({
      id: result.lastID,
      name: name.trim(),
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

    if (!Number.isInteger(habitId) || habitId <= 0) {
      return res.status(400).json({ error: 'Invalid habit id' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Habit name required' });
    }

    const habit = await get(
      'SELECT id, schedule_type AS scheduleType, days_of_week AS daysOfWeek FROM habits WHERE id = ? AND user_id = ?',
      [habitId, req.user.userId]
    );
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const schedule = parseScheduleInput(
      scheduleType || habit.scheduleType,
      daysOfWeek !== undefined ? daysOfWeek : habit.daysOfWeek ? habit.daysOfWeek.split(',') : []
    );
    if (schedule.error) {
      return res.status(400).json({ error: schedule.error });
    }

    const nextName = name.trim();
    await run(
      'UPDATE habits SET name = ?, schedule_type = ?, days_of_week = ? WHERE id = ? AND user_id = ?',
      [nextName, schedule.scheduleType, schedule.daysOfWeekCsv, habitId, req.user.userId]
    );

    return res.json({
      id: habitId,
      name: nextName,
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
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const dayOfWeek = today.getDay();

    const rows = await all(
      `
      SELECT
        h.id AS habitId,
        h.name,
        h.schedule_type AS scheduleType,
        h.days_of_week AS daysOfWeek,
        COALESCE(e.completed, 0) AS completed,
        COALESCE(e.notes, '') AS notes
      FROM habits h
      LEFT JOIN habit_entries e
        ON e.habit_id = h.id
       AND e.entry_date = ?
      WHERE h.user_id = ?
        AND (
          h.schedule_type = 'daily'
          OR (h.schedule_type = 'weekly' AND CAST(strftime('%w', h.created_at) AS INTEGER) = ?)
          OR (
            h.schedule_type = 'specific_days'
            AND instr(',' || h.days_of_week || ',', ',' || ? || ',') > 0
          )
        )
      ORDER BY h.id DESC
      `,
      [todayIso, req.user.userId, dayOfWeek, String(dayOfWeek)]
    );

    return res.json({ date: todayIso, habits: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/entries/day', auth, async (req, res) => {
  try {
    const { date } = req.query;
    if (typeof date !== 'string') {
      return res.status(400).json({ error: 'date query param is required (YYYY-MM-DD)' });
    }
    const targetDate = parseDateYmd(date);
    if (!targetDate) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const habits = await all(
      `
      SELECT id, name, schedule_type, days_of_week, created_at
      FROM habits
      WHERE user_id = ?
      ORDER BY id DESC
      `,
      [req.user.userId]
    );

    const entries = await all(
      `
      SELECT e.habit_id, e.completed, COALESCE(e.notes, '') AS notes
      FROM habit_entries e
      JOIN habits h ON h.id = e.habit_id
      WHERE h.user_id = ? AND e.entry_date = ?
      `,
      [req.user.userId, date]
    );
    const entryByHabitId = new Map(entries.map((e) => [e.habit_id, e]));

    const dueHabits = habits
      .filter((habit) => isHabitDueOnDate(habit, targetDate))
      .map((habit) => {
        const entry = entryByHabitId.get(habit.id);
        return {
          habitId: habit.id,
          name: habit.name,
          scheduleType: habit.schedule_type,
          daysOfWeek: habit.days_of_week || '',
          completed: entry ? entry.completed : 0,
          notes: entry ? entry.notes : '',
        };
      });

    return res.json({ date, habits: dueHabits });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/entries/month', auth, async (req, res) => {
  try {
    const { month } = req.query;
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month query param is required (YYYY-MM)' });
    }

    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const firstDay = new Date(year, monthIndex, 1);
    if (Number.isNaN(firstDay.getTime()) || firstDay.getMonth() !== monthIndex) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }
    const lastDay = new Date(year, monthIndex + 1, 0);
    const startYmd = formatDateYmd(firstDay);
    const endYmd = formatDateYmd(lastDay);

    const habits = await all(
      `
      SELECT id, name, schedule_type, days_of_week, created_at
      FROM habits
      WHERE user_id = ?
      ORDER BY id DESC
      `,
      [req.user.userId]
    );

    const entries = await all(
      `
      SELECT e.habit_id, e.entry_date, e.completed
      FROM habit_entries e
      JOIN habits h ON h.id = e.habit_id
      WHERE h.user_id = ?
        AND e.entry_date >= ?
        AND e.entry_date <= ?
      `,
      [req.user.userId, startYmd, endYmd]
    );
    const entriesByDayHabit = new Map(
      entries.map((e) => [`${e.entry_date}::${e.habit_id}`, Number(e.completed)])
    );

    const days = [];
    for (let d = 1; d <= lastDay.getDate(); d += 1) {
      const current = new Date(year, monthIndex, d);
      const date = formatDateYmd(current);
      const dueHabits = habits.filter((habit) => isHabitDueOnDate(habit, current));
      const totalHabits = dueHabits.length;
      let completedHabits = 0;
      dueHabits.forEach((habit) => {
        const key = `${date}::${habit.id}`;
        if (entriesByDayHabit.get(key) === 1) {
          completedHabits += 1;
        }
      });

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
