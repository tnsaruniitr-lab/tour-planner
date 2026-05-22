import { useState } from 'react';

// Simple demo gate. NOTE: this is a client-side check — the credentials
// ship in the JS bundle, so it keeps casual visitors out but is not real
// security. Fine for a demo; use a real auth backend for anything else.
const AUTH_USER = 'dostel_test';
const AUTH_PASS = 'dosteli_test';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (username.trim() === AUTH_USER && password === AUTH_PASS) {
      onLogin();
    } else {
      setError(true);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>Outpatient Touring</h1>
        <p className="sub">Sign in to continue</p>

        <div className="field">
          <label>Username</label>
          <input
            type="text"
            value={username}
            autoFocus
            autoComplete="username"
            onChange={(e) => {
              setUsername(e.target.value);
              setError(false);
            }}
          />
        </div>

        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
          />
        </div>

        {error && (
          <div className="status err">Incorrect username or password.</div>
        )}

        <button type="submit" className="btn-go">
          Sign in
        </button>
      </form>
    </div>
  );
}
