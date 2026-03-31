import React, { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

async function api(path, method = 'GET', body, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function scheduleLabel(scheduleType, daysOfWeek) {
  if (scheduleType === 'weekly') return 'Weekly';
  if (scheduleType === 'specific_days') {
    const labels = String(daysOfWeek || '')
      .split(',')
      .map(Number)
      .map((d) => DAYS.find((x) => x.value === d)?.label)
      .filter(Boolean);
    return labels.length ? `Specific: ${labels.join(', ')}` : 'Specific days';
  }
  return 'Daily';
}

function DayPicker({ selected, onToggle }) {
  return (
    <div className="day-picker">
      {DAYS.map((day) => (
        <label key={day.value}>
          <input
            type="checkbox"
            checked={selected.includes(day.value)}
            onChange={() => onToggle(day.value)}
          />
          {day.label}
        </label>
      ))}
    </div>
  );
}

function parseDaysCsv(csv) {
  return String(csv || '')
    .split(',')
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [activeTab, setActiveTab] = useState('today');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [captchaId, setCaptchaId] = useState('');
  const [captchaQuestion, setCaptchaQuestion] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);

  const [habitName, setHabitName] = useState('');
  const [scheduleType, setScheduleType] = useState('daily');
  const [selectedDays, setSelectedDays] = useState([]);

  const [today, setToday] = useState({ date: '', habits: [] });
  const [habits, setHabits] = useState([]);
  const [notes, setNotes] = useState({});

  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('daily');
  const [editDays, setEditDays] = useState([]);

  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [monthDays, setMonthDays] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedDateHabits, setSelectedDateHabits] = useState([]);
  const [selectedDateLoading, setSelectedDateLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!token && !captchaId) {
      loadCaptcha().catch((e) => setError(e.message));
    }
  }, [token, captchaId]);

  useEffect(() => {
    if (token) refreshAll().catch((e) => setError(e.message));
  }, [token]);

  useEffect(() => {
    if (token) loadMonth(selectedMonth).catch((e) => setError(e.message));
  }, [selectedMonth, token]);

  async function loadCaptcha() {
    setCaptchaLoading(true);
    try {
      const data = await api('/api/captcha');
      setCaptchaId(data.captchaId || '');
      setCaptchaQuestion(data.question || '');
      setCaptchaAnswer('');
    } finally {
      setCaptchaLoading(false);
    }
  }

  async function loadToday() {
    const data = await api('/api/entries/today', 'GET', undefined, token);
    const habitsList = Array.isArray(data?.habits)
      ? data.habits.map((h) => ({
          habitId: h.habitId,
          name: h.name,
          scheduleType: String(h.scheduleType || h.schedule_type || 'daily').toLowerCase(),
          daysOfWeek: String(h.daysOfWeek || h.days_of_week || ''),
          completed: Number(h.completed) === 1 ? 1 : 0,
          notes: String(h.notes || ''),
        }))
      : [];

    setToday({ date: String(data?.date || ''), habits: habitsList });

    setNotes((prev) => {
      const next = {};
      for (const h of habitsList) next[h.habitId] = prev[h.habitId] ?? h.notes ?? '';
      return next;
    });
  }

  async function loadHabits() {
    const data = await api('/api/habits', 'GET', undefined, token);
    setHabits(
      Array.isArray(data)
        ? data.map((h) => ({
            habitId: h.id,
            name: h.name,
            scheduleType: String(h.scheduleType || h.schedule_type || 'daily').toLowerCase(),
            daysOfWeek: String(h.daysOfWeek || h.days_of_week || ''),
          }))
        : []
    );
  }

  async function loadMonth(month) {
    setCalendarLoading(true);
    try {
      const data = await api(`/api/entries/month?month=${month}`, 'GET', undefined, token);
      setMonthDays(Array.isArray(data?.days) ? data.days : []);
    } finally {
      setCalendarLoading(false);
    }
  }

  async function refreshAll() {
    await loadToday();
    await loadHabits();
    await loadMonth(selectedMonth);
  }

  async function submitAuth(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = isRegister ? '/api/register' : '/api/login';
      const data = await api(endpoint, 'POST', { email, password, captchaId, captchaAnswer });
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setEmail('');
      setPassword('');
      setCaptchaId('');
      setCaptchaQuestion('');
      setCaptchaAnswer('');
    } catch (err) {
      setError(err.message);
      try {
        await loadCaptcha();
      } catch (captchaErr) {
        setError(captchaErr.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function toggleArrayDay(setter, day) {
    setter((prev) => (prev.includes(day) ? prev.filter((x) => x !== day) : [...prev, day].sort((a, b) => a - b)));
  }

  async function addHabit(e) {
    e.preventDefault();
    if (!habitName.trim()) return;

    setError('');
    setLoading(true);
    try {
      await api(
        '/api/habits',
        'POST',
        { name: habitName, scheduleType, daysOfWeek: scheduleType === 'specific_days' ? selectedDays : [] },
        token
      );
      setHabitName('');
      setScheduleType('daily');
      setSelectedDays([]);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(habit) {
    setEditId(habit.habitId);
    setEditName(habit.name);
    setEditType(habit.scheduleType || 'daily');
    setEditDays(parseDaysCsv(habit.daysOfWeek));
  }

  function cancelEdit() {
    setEditId(null);
    setEditName('');
    setEditType('daily');
    setEditDays([]);
  }

  async function saveEdit(habitId) {
    if (!editName.trim()) return;

    setError('');
    setLoading(true);
    try {
      await api(
        `/api/habits/${habitId}`,
        'PUT',
        { name: editName, scheduleType: editType, daysOfWeek: editType === 'specific_days' ? editDays : [] },
        token
      );
      await refreshAll();
      cancelEdit();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function removeHabit(habitId) {
    setError('');
    setLoading(true);
    try {
      await api(`/api/habits/${habitId}`, 'DELETE', undefined, token);
      setToday((prev) => ({ ...prev, habits: prev.habits.filter((h) => h.habitId !== habitId) }));
      setHabits((prev) => prev.filter((h) => h.habitId !== habitId));
      await loadMonth(selectedMonth);
      if (editId === habitId) cancelEdit();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleDone(habitId, completed) {
    setError('');
    try {
      await api('/api/entries/today', 'POST', { habitId, completed }, token);
      setToday((prev) => ({
        ...prev,
        habits: prev.habits.map((h) => (h.habitId === habitId ? { ...h, completed: completed ? 1 : 0 } : h)),
      }));
      await loadMonth(selectedMonth);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveNote(habitId) {
    setError('');
    setLoading(true);
    try {
      const habit = today.habits.find((h) => h.habitId === habitId);
      const completed = Boolean(habit?.completed);
      const note = notes[habitId] || '';
      await api('/api/entries/today', 'POST', { habitId, completed, notes: note }, token);
      setToday((prev) => ({ ...prev, habits: prev.habits.map((h) => (h.habitId === habitId ? { ...h, notes: note } : h)) }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function openDate(date) {
    setSelectedDate(date);
    setError('');
    setSelectedDateLoading(true);
    try {
      const data = await api(`/api/entries/day?date=${date}`, 'GET', undefined, token);
      setSelectedDateHabits(Array.isArray(data?.habits) ? data.habits : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSelectedDateLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('token');
    setToken('');
    setToday({ date: '', habits: [] });
    setHabits([]);
    setNotes({});
    setMonthDays([]);
    setSelectedDate('');
    setSelectedDateHabits([]);
    setActiveTab('today');
  }

  const mergedHabits = useMemo(() => {
    const map = new Map(today.habits.map((h) => [h.habitId, h]));
    return habits.map((h) => {
      const t = map.get(h.habitId);
      return {
        ...h,
        isDueToday: Boolean(t),
        completed: t ? t.completed : 0,
      };
    });
  }, [habits, today.habits]);

  const calendarCells = useMemo(() => {
    const first = new Date(`${selectedMonth}-01T00:00:00`);
    const offset = Number.isNaN(first.getTime()) ? 0 : first.getDay();
    const cells = [];
    for (let i = 0; i < offset; i += 1) cells.push({ key: `e-${i}`, empty: true });
    monthDays.forEach((d, i) => {
      cells.push({ ...d, dayNum: Number(String(d.date).split('-')[2]), key: `d-${i}-${d.date}`, empty: false });
    });
    return cells;
  }, [monthDays, selectedMonth]);

  if (!token) {
    return (
      <main className="container">
        <header className="header">
          <h1>Habit Tracker</h1>
          <button type="button" onClick={() => setTheme((p) => (p === 'light' ? 'dark' : 'light'))}>
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </button>
        </header>

        <form onSubmit={submitAuth} className="card">
          <h2>{isRegister ? 'Register' : 'Login'}</h2>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <div className="captcha-box">
            <p>{captchaLoading ? 'Loading captcha...' : `Captcha: ${captchaQuestion}`}</p>
            <input
              type="text"
              placeholder="Enter captcha answer"
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              required
              disabled={captchaLoading}
            />
            <button type="button" onClick={() => loadCaptcha().catch((err) => setError(err.message))}>
              Refresh Captcha
            </button>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Login'}
          </button>

          <button type="button" className="link" onClick={() => setIsRegister((v) => !v)}>
            {isRegister ? 'Have an account? Login' : 'Need an account? Register'}
          </button>
        </form>

        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  return (
    <main className="container">
      <header className="header">
        <h1>Habit Tracker</h1>
        <div className="header-actions">
          <button type="button" onClick={() => setTheme((p) => (p === 'light' ? 'dark' : 'light'))}>
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </button>
          <button type="button" onClick={logout}>Logout</button>
        </div>
      </header>

      <div className="tabs">
        <button type="button" className={activeTab === 'add' ? 'tab tab-active' : 'tab'} onClick={() => setActiveTab('add')}>Add Habit</button>
        <button type="button" className={activeTab === 'today' ? 'tab tab-active' : 'tab'} onClick={() => setActiveTab('today')}>Today</button>
        <button type="button" className={activeTab === 'calendar' ? 'tab tab-active' : 'tab'} onClick={() => setActiveTab('calendar')}>Calendar</button>
      </div>

      {activeTab === 'add' && (
        <form onSubmit={addHabit} className="card">
          <h2>Add Habit</h2>
          <input type="text" placeholder="e.g. Drink 2L water" value={habitName} onChange={(e) => setHabitName(e.target.value)} />
          <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="specific_days">Specific days</option>
          </select>
          {scheduleType === 'specific_days' && <DayPicker selected={selectedDays} onToggle={(d) => toggleArrayDay(setSelectedDays, d)} />}
          <button type="submit" disabled={loading}>Add</button>
        </form>
      )}

      {activeTab === 'today' && (
        <section className="card">
          <h2>Habits (Today: {today.date || '-'})</h2>
          {mergedHabits.length === 0 && <p>No habits yet. Add one above.</p>}

          <ul>
            {mergedHabits.map((habit) => (
              <li key={habit.habitId} className="habit-item">
                <div className="habit-row">
                  <label className="habit-check">
                    <input
                      type="checkbox"
                      checked={Boolean(habit.completed)}
                      disabled={!habit.isDueToday}
                      onChange={(e) => toggleDone(habit.habitId, e.target.checked)}
                    />
                  </label>

                  <div className="habit-main">
                    {editId === habit.habitId ? (
                      <div className="edit-panel">
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
                        <select value={editType} onChange={(e) => setEditType(e.target.value)}>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="specific_days">Specific days</option>
                        </select>
                        {editType === 'specific_days' && <DayPicker selected={editDays} onToggle={(d) => toggleArrayDay(setEditDays, d)} />}
                      </div>
                    ) : (
                      <span>
                        {habit.name}
                        <span className="habit-meta"> ({scheduleLabel(habit.scheduleType, habit.daysOfWeek)})</span>
                      </span>
                    )}
                  </div>

                  <div className="habit-actions">
                    {editId === habit.habitId ? (
                      <>
                        <button type="button" className="action-primary" onClick={() => saveEdit(habit.habitId)} disabled={loading}>Save</button>
                        <button type="button" className="action-secondary" onClick={cancelEdit} disabled={loading}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="action-secondary" onClick={() => startEdit(habit)} disabled={loading}>Edit</button>
                        <button type="button" className="action-danger" onClick={() => removeHabit(habit.habitId)} disabled={loading}>Delete</button>
                      </>
                    )}
                  </div>
                </div>

                <div className="habit-note">
                  <input
                    type="text"
                    placeholder={habit.isDueToday ? 'Add note about this activity' : 'Not scheduled today'}
                    value={notes[habit.habitId] || ''}
                    disabled={!habit.isDueToday}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [habit.habitId]: e.target.value }))}
                  />
                  <button type="button" className="action-primary" onClick={() => saveNote(habit.habitId)} disabled={loading || !habit.isDueToday}>
                    Save Note
                  </button>
                </div>

                {!habit.isDueToday && <p className="habit-meta habit-meta-warning">Not scheduled for today</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeTab === 'calendar' && (
        <section className="card">
          <h2>Monthly Calendar</h2>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => {
              setSelectedMonth(e.target.value);
              setSelectedDate('');
              setSelectedDateHabits([]);
            }}
          />

          <div className="calendar-head">
            {DAYS.map((d) => (
              <div key={`h-${d.value}`} className="calendar-head-cell">{d.label}</div>
            ))}
          </div>

          <div className="calendar-grid">
            {calendarCells.map((cell) =>
              cell.empty ? (
                <div key={cell.key} className="calendar-cell calendar-empty" />
              ) : (
                <button
                  key={cell.key}
                  type="button"
                  className={`calendar-cell calendar-${cell.status} ${selectedDate === cell.date ? 'calendar-selected' : ''}`}
                  onClick={() => openDate(cell.date)}
                  title={`${cell.date} (${cell.completedHabits}/${cell.totalHabits})`}
                >
                  <span>{cell.dayNum}</span>
                </button>
              )
            )}
          </div>

          {calendarLoading && <p>Loading calendar...</p>}

          {selectedDate && (
            <div className="day-details">
              <h3>{selectedDate}</h3>
              {selectedDateLoading && <p>Loading habits...</p>}
              {!selectedDateLoading && selectedDateHabits.length === 0 && <p>No scheduled habits for this day.</p>}
              {!selectedDateLoading && selectedDateHabits.length > 0 && (
                <ul>
                  {selectedDateHabits.map((h) => (
                    <li key={`day-${h.habitId}`}>
                      <span>
                        {h.name}
                        <span className="habit-meta"> ({scheduleLabel(h.scheduleType, h.daysOfWeek)})</span>
                      </span>
                      <span className={h.completed ? 'day-status done' : 'day-status missed'}>
                        {h.completed ? 'Done' : 'Not done'}
                      </span>
                      {h.notes ? <p className="habit-meta">Note: {h.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}
