import React, { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

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
        }))
      : [],
  };
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [habitName, setHabitName] = useState('');
  const [today, setToday] = useState({ date: '', habits: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editHabitId, setEditHabitId] = useState(null);
  const [editHabitName, setEditHabitName] = useState('');
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

  useEffect(() => {
    if (!token) return;
    loadToday().catch((err) => setError(err.message));
  }, [token]);

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
    setError('');
    setLoading(true);
    try {
      await api('/api/habits', 'POST', { name: habitName }, token);
      setHabitName('');
      await loadToday();
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
  }

  function cancelEdit() {
    setEditHabitId(null);
    setEditHabitName('');
  }

  async function saveEdit(habitId) {
    if (!editHabitName.trim()) return;
    setError('');
    setLoading(true);
    try {
      await api(`/api/habits/${habitId}`, 'PUT', { name: editHabitName }, token);
      setToday((prev) => ({
        ...prev,
        habits: prev.habits.map((h) =>
          h.habitId === habitId ? { ...h, name: editHabitName.trim() } : h
        ),
      }));
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
    setNoteDrafts({});
  }

  function toggleTheme() {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
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

      <form onSubmit={addHabit} className="card">
        <h2>Add Habit</h2>
        <input
          type="text"
          placeholder="e.g. Drink 2L water"
          value={habitName}
          onChange={(e) => setHabitName(e.target.value)}
        />
        <button type="submit" disabled={loading}>Add</button>
      </form>

      <section className="card">
        <h2>Today ({today.date || '-'})</h2>
        {today.habits.length === 0 && <p>No habits yet. Add one above.</p>}
        <ul>
          {today.habits.map((habit) => (
            <li key={habit.habitId}>
              <div className="habit-row">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(habit.completed)}
                    onChange={(e) => toggleHabit(habit.habitId, e.target.checked)}
                  />
                  {editHabitId === habit.habitId ? (
                    <input
                      type="text"
                      value={editHabitName}
                      onChange={(e) => setEditHabitName(e.target.value)}
                    />
                  ) : (
                    <span>{habit.name}</span>
                  )}
                </label>
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
                  placeholder="Add note about this activity"
                  value={noteDrafts[habit.habitId] || ''}
                  onChange={(e) =>
                    setNoteDrafts((prev) => ({ ...prev, [habit.habitId]: e.target.value }))
                  }
                />
                <button type="button" onClick={() => saveNote(habit.habitId)} disabled={loading}>
                  Save Note
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
