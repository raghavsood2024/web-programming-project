import React, { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const WEEK_DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

function api(path, method = 'GET', body, token) {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
}

function normalizeTodayResponse(data) {
  return {
    date: typeof data?.date === 'string' ? data.date : '',
    habits: Array.isArray(data?.habits)
      ? data.habits.map((habit) => ({
          ...habit,
          notes: typeof habit?.notes === 'string' ? habit.notes : '',
          scheduleType: String(habit?.scheduleType || habit?.schedule_type || 'daily').toLowerCase(),
          daysOfWeek:
            typeof habit?.daysOfWeek === 'string'
              ? habit.daysOfWeek
              : typeof habit?.days_of_week === 'string'
                ? habit.days_of_week
                : '',
        }))
      : [],
  };
}

function normalizeHabitsResponse(data) {
  return Array.isArray(data)
    ? data.map((habit) => ({
        habitId: habit.id,
        name: habit.name,
        scheduleType: String(habit.scheduleType || habit.schedule_type || 'daily').toLowerCase(),
        daysOfWeek:
          typeof habit.daysOfWeek === 'string'
            ? habit.daysOfWeek
            : typeof habit.days_of_week === 'string'
              ? habit.days_of_week
              : '',
      }))
    : [];
}

function formatScheduleLabel(habit) {
  if (habit.scheduleType === 'weekly') return 'Weekly';
  if (habit.scheduleType === 'specific_days') {
    const days = (habit.daysOfWeek || '')
      .split(',')
      .filter((v) => v !== '')
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6)
      .map((v) => WEEK_DAYS.find((d) => d.value === v)?.label)
      .filter(Boolean);
    return days.length > 0 ? `Specific: ${days.join(', ')}` : 'Specific days';
  }
  return 'Daily';
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [habitName, setHabitName] = useState('');
  const [scheduleType, setScheduleType] = useState('daily');
  const [selectedDays, setSelectedDays] = useState([]);
  const [today, setToday] = useState({ date: '', habits: [] });
  const [allHabits, setAllHabits] = useState([]);
  const [activeTab, setActiveTab] = useState('today');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [calendarDays, setCalendarDays] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState('');
  const [selectedDateHabits, setSelectedDateHabits] = useState([]);
  const [selectedDateLoading, setSelectedDateLoading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editHabitId, setEditHabitId] = useState(null);
  const [editHabitName, setEditHabitName] = useState('');
  const [editScheduleType, setEditScheduleType] = useState('daily');
  const [editSelectedDays, setEditSelectedDays] = useState([]);
  const [noteDrafts, setNoteDrafts] = useState({});

  function applyTodayData(data) {
    const normalized = normalizeTodayResponse(data);
    setToday(normalized);
    setNoteDrafts((prev) => {
      const next = {};
      normalized.habits.forEach((habit) => {
        const currentDraft = prev[habit.habitId];
        next[habit.habitId] = typeof currentDraft === 'string' ? currentDraft : habit.notes || '';
      });
      return next;
    });
  }

  async function loadToday(authToken = token) {
    const data = await api('/api/entries/today', 'GET', undefined, authToken);
    applyTodayData(data);
  }

  async function loadHabits(authToken = token) {
    const data = await api('/api/habits', 'GET', undefined, authToken);
    setAllHabits(normalizeHabitsResponse(data));
  }

  async function loadMonth(month = selectedMonth, authToken = token) {
    setCalendarLoading(true);
    try {
      const data = await api(`/api/entries/month?month=${month}`, 'GET', undefined, authToken);
      setCalendarDays(Array.isArray(data?.days) ? data.days : []);
    } finally {
      setCalendarLoading(false);
    }
  }

  async function loadDayDetails(date, authToken = token) {
    setSelectedDateLoading(true);
    try {
      const data = await api(`/api/entries/day?date=${date}`, 'GET', undefined, authToken);
      setSelectedDateHabits(Array.isArray(data?.habits) ? data.habits : []);
    } finally {
      setSelectedDateLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    Promise.all([loadToday(), loadHabits(), loadMonth(selectedMonth)]).catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadMonth(selectedMonth).catch((err) => setError(err.message));
  }, [selectedMonth, token]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  async function handleAuth(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = isRegister ? '/api/register' : '/api/login';
      const data = await api(endpoint, 'POST', { email, password });
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setEmail('');
      setPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function addHabit(e) {
    e.preventDefault();
    if (!habitName.trim()) return;
    if (scheduleType === 'specific_days' && selectedDays.length === 0) {
      setError('Select at least one day for specific-days schedule');
      return;
    }
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
      await Promise.all([loadToday(), loadHabits()]);
      await loadMonth(selectedMonth);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleHabit(habitId, completed) {
    setError('');
    try {
      await api('/api/entries/today', 'POST', { habitId, completed }, token);
      setToday((prev) => ({
        ...prev,
        habits: prev.habits.map((h) =>
          h.habitId === habitId ? { ...h, completed: completed ? 1 : 0 } : h
        ),
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
      const note = noteDrafts[habitId] || '';
      const habit = today.habits.find((h) => h.habitId === habitId);
      const completed = Boolean(habit?.completed);
      await api('/api/entries/today', 'POST', { habitId, completed, notes: note }, token);
      setToday((prev) => ({
        ...prev,
        habits: prev.habits.map((h) => (h.habitId === habitId ? { ...h, notes: note } : h)),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(habit) {
    setEditHabitId(habit.habitId);
    setEditHabitName(habit.name);
    setEditScheduleType(habit.scheduleType || 'daily');
    setEditSelectedDays(
      (habit.daysOfWeek || '')
        .split(',')
        .filter((v) => v !== '')
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6)
    );
  }

  function cancelEdit() {
    setEditHabitId(null);
    setEditHabitName('');
    setEditScheduleType('daily');
    setEditSelectedDays([]);
  }

  async function saveEdit(habitId) {
    if (!editHabitName.trim()) return;
    if (editScheduleType === 'specific_days' && editSelectedDays.length === 0) {
      setError('Select at least one day for specific-days schedule');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api(
        `/api/habits/${habitId}`,
        'PUT',
        {
          name: editHabitName,
          scheduleType: editScheduleType,
          daysOfWeek: editScheduleType === 'specific_days' ? editSelectedDays : [],
        },
        token
      );
      await Promise.all([loadToday(), loadHabits(), loadMonth(selectedMonth)]);
      cancelEdit();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteHabit(habitId) {
    setError('');
    setLoading(true);
    try {
      await api(`/api/habits/${habitId}`, 'DELETE', undefined, token);
      setToday((prev) => ({
        ...prev,
        habits: prev.habits.filter((h) => h.habitId !== habitId),
      }));
      setAllHabits((prev) => prev.filter((h) => h.habitId !== habitId));
      await loadMonth(selectedMonth);
      if (editHabitId === habitId) {
        cancelEdit();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('token');
    setToken('');
    setToday({ date: '', habits: [] });
    setAllHabits([]);
    setCalendarDays([]);
    setSelectedCalendarDate('');
    setSelectedDateHabits([]);
    setNoteDrafts({});
  }

  function toggleTheme() {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }

  function toggleSelectedDay(dayValue) {
    setSelectedDays((prev) =>
      prev.includes(dayValue) ? prev.filter((d) => d !== dayValue) : [...prev, dayValue].sort((a, b) => a - b)
    );
  }

  function toggleEditSelectedDay(dayValue) {
    setEditSelectedDays((prev) =>
      prev.includes(dayValue) ? prev.filter((d) => d !== dayValue) : [...prev, dayValue].sort((a, b) => a - b)
    );
  }

  const todayByHabitId = new Map(today.habits.map((h) => [h.habitId, h]));
  const habitsForView = allHabits.map((habit) => {
    const todayData = todayByHabitId.get(habit.habitId);
    return {
      ...habit,
      isDueToday: Boolean(todayData),
      completed: todayData ? todayData.completed : 0,
      notes: todayData ? todayData.notes : '',
    };
  });

  const monthFirstDay = selectedMonth ? new Date(`${selectedMonth}-01T00:00:00`) : new Date();
  const monthStartOffset = Number.isNaN(monthFirstDay.getTime()) ? 0 : monthFirstDay.getDay();
  const dayMap = new Map(calendarDays.map((day) => [day.date, day]));
  const calendarCells = [];
  for (let i = 0; i < monthStartOffset; i += 1) {
    calendarCells.push({ empty: true, key: `empty-${i}` });
  }
  calendarDays.forEach((day, index) => {
    const dayNum = Number(day.date.split('-')[2]);
    calendarCells.push({ ...day, dayNum, empty: false, key: `day-${index}-${day.date}` });
  });

  async function handleCalendarDayClick(date) {
    setSelectedCalendarDate(date);
    setError('');
    try {
      await loadDayDetails(date);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!token) {
    return (
      <main className="container">
        <header className="header">
          <h1>Habit Tracker</h1>
          <button type="button" onClick={toggleTheme}>
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </button>
        </header>
        <form onSubmit={handleAuth} className="card">
          <h2>{isRegister ? 'Register' : 'Login'}</h2>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password (min 6 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
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
          <button type="button" onClick={toggleTheme}>
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </button>
          <button type="button" onClick={logout}>Logout</button>
        </div>
      </header>

      <div className="tabs">
        <button
          type="button"
          className={activeTab === 'add' ? 'tab tab-active' : 'tab'}
          onClick={() => setActiveTab('add')}
        >
          Add Habit
        </button>
        <button
          type="button"
          className={activeTab === 'today' ? 'tab tab-active' : 'tab'}
          onClick={() => setActiveTab('today')}
        >
          Today
        </button>
        <button
          type="button"
          className={activeTab === 'calendar' ? 'tab tab-active' : 'tab'}
          onClick={() => setActiveTab('calendar')}
        >
          Calendar
        </button>
      </div>

      {activeTab === 'add' && (
        <form onSubmit={addHabit} className="card">
          <h2>Add Habit</h2>
          <input
            type="text"
            placeholder="e.g. Drink 2L water"
            value={habitName}
            onChange={(e) => setHabitName(e.target.value)}
          />
          <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="specific_days">Specific days</option>
          </select>
          {scheduleType === 'specific_days' && (
            <div className="day-picker">
              {WEEK_DAYS.map((day) => (
                <label key={day.value}>
                  <input
                    type="checkbox"
                    checked={selectedDays.includes(day.value)}
                    onChange={() => toggleSelectedDay(day.value)}
                  />
                  {day.label}
                </label>
              ))}
            </div>
          )}
          <button type="submit" disabled={loading}>Add</button>
        </form>
      )}

      {activeTab === 'today' && (
        <section className="card">
          <h2>Habits (Today: {today.date || '-'})</h2>
          {habitsForView.length === 0 && <p>No habits yet. Add one above.</p>}
          <ul>
            {habitsForView.map((habit) => (
              <li key={habit.habitId}>
                <div className="habit-row">
                  <label className="habit-check">
                    <input
                      type="checkbox"
                      checked={Boolean(habit.completed)}
                      disabled={!habit.isDueToday}
                      onChange={(e) => toggleHabit(habit.habitId, e.target.checked)}
                    />
                  </label>
                  <div className="habit-main">
                    {editHabitId === habit.habitId ? (
                      <div className="edit-panel">
                        <input
                          type="text"
                          value={editHabitName}
                          onChange={(e) => setEditHabitName(e.target.value)}
                        />
                        <select value={editScheduleType} onChange={(e) => setEditScheduleType(e.target.value)}>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="specific_days">Specific days</option>
                        </select>
                        {editScheduleType === 'specific_days' && (
                          <div className="day-picker">
                            {WEEK_DAYS.map((day) => (
                              <label key={day.value}>
                                <input
                                  type="checkbox"
                                  checked={editSelectedDays.includes(day.value)}
                                  onChange={() => toggleEditSelectedDay(day.value)}
                                />
                                {day.label}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span>
                        {habit.name}
                        <span className="habit-meta"> ({formatScheduleLabel(habit)})</span>
                      </span>
                    )}
                  </div>
                  <div className="habit-actions">
                    {editHabitId === habit.habitId ? (
                      <>
                        <button type="button" onClick={() => saveEdit(habit.habitId)} disabled={loading}>
                          Save
                        </button>
                        <button type="button" onClick={cancelEdit} disabled={loading}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => startEdit(habit)} disabled={loading}>
                          Edit
                        </button>
                        <button type="button" onClick={() => deleteHabit(habit.habitId)} disabled={loading}>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="habit-note">
                  <input
                    type="text"
                    placeholder={habit.isDueToday ? 'Add note about this activity' : 'Not scheduled today'}
                    value={noteDrafts[habit.habitId] || ''}
                    disabled={!habit.isDueToday}
                    onChange={(e) =>
                      setNoteDrafts((prev) => ({ ...prev, [habit.habitId]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => saveNote(habit.habitId)}
                    disabled={loading || !habit.isDueToday}
                  >
                    Save Note
                  </button>
                </div>
                {!habit.isDueToday && <p className="habit-meta">Not scheduled for today</p>}
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
              setSelectedCalendarDate('');
              setSelectedDateHabits([]);
            }}
          />
          <div className="calendar-head">
            {WEEK_DAYS.map((day) => (
              <div key={`head-${day.value}`} className="calendar-head-cell">{day.label}</div>
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
                  className={`calendar-cell calendar-${cell.status} ${
                    selectedCalendarDate === cell.date ? 'calendar-selected' : ''
                  }`}
                  onClick={() => handleCalendarDayClick(cell.date)}
                  title={`${cell.date} (${cell.completedHabits}/${cell.totalHabits})`}
                >
                  <span>{cell.dayNum}</span>
                </button>
              )
            )}
          </div>
          {calendarLoading && <p>Loading calendar...</p>}

          {selectedCalendarDate && (
            <div className="day-details">
              <h3>{selectedCalendarDate}</h3>
              {selectedDateLoading && <p>Loading habits...</p>}
              {!selectedDateLoading && selectedDateHabits.length === 0 && (
                <p>No scheduled habits for this day.</p>
              )}
              {!selectedDateLoading && selectedDateHabits.length > 0 && (
                <ul>
                  {selectedDateHabits.map((habit) => (
                    <li key={`day-${habit.habitId}`}>
                      <span>
                        {habit.name}
                        <span className="habit-meta"> ({formatScheduleLabel(habit)})</span>
                      </span>
                      <span className={habit.completed ? 'day-status done' : 'day-status missed'}>
                        {habit.completed ? 'Done' : 'Not done'}
                      </span>
                      {habit.notes ? <p className="habit-meta">Note: {habit.notes}</p> : null}
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
