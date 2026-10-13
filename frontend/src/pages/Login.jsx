import React, { useState } from 'react';
import { useAuth } from '../auth.jsx';

const DEMO = ['admin', 'analyst', 'viewer'];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@pureinsights.demo');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <h1>Pure Insights Command Center</h1>
      <p className="muted">Platform operational analytics. Snowflake is simulated (DuckDB); data is synthetic.</p>
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="muted">
        Demo users:{' '}
        {DEMO.map((r) => (
          <button key={r} className="link" type="button" onClick={() => setEmail(`${r}@pureinsights.demo`)}>
            {r}
          </button>
        ))}{' '}
        (password in README)
      </p>
    </main>
  );
}
