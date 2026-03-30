import { useEffect, useState } from 'react';

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

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [habitName, setHabitName] = useState('');
  const [today, setToday] = useState({ date: '', habits: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadToday(authToken = token) {
    const data = await api('/api/entries/today', 'GET', undefined, authToken);
    setToday(data);
  }

  useEffect(() => {
    if (!token) return;
    loadToday().catch((err) => setError(err.message));
  }, [token]);

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
        habits: prev.habits.map((h) => (h.habitId === habitId ? { ...h, completed: completed ? 1 : 0 } : h)),
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  function logout() {
    localStorage.removeItem('token');
    setToken('');
    setToday({ date: '', habits: [] });
  }

  if (!token) {
    return (
      <main className="container">
        <h1>Habit Tracker</h1>
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
        <button onClick={logout}>Logout</button>
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
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(habit.completed)}
                  onChange={(e) => toggleHabit(habit.habitId, e.target.checked)}
                />
                {habit.name}
              </label>
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
