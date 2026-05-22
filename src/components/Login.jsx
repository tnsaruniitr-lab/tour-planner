import { useState } from 'react';

// Simple demo gate. NOTE: this is a client-side check — the credentials
// ship in the JS bundle, so it keeps casual visitors out but is not real
// security. Fine for a demo; use a real auth backend for anything else.
const AUTH_USER = 'dosteli_test';
const AUTH_PASS = 'dosteli_test';

const STOPS = [
  [40, 104],
  [96, 60],
  [150, 100],
  [214, 50],
];

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
      <div className="login-card">
        <aside className="login-hero">
          <div className="login-brand">
            <span className="login-logo" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 21s6.5-5.4 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.6 6.5 11 6.5 11Z" />
                <path d="M12 12.7c-1.2-.9-2.4-1.8-2.4-3.1a1.18 1.18 0 0 1 2.4-.4 1.18 1.18 0 0 1 2.4.4c0 1.3-1.2 2.2-2.4 3.1Z" />
              </svg>
            </span>
            <span>Outpatient Touring</span>
          </div>

          <div className="login-hero-body">
            <h2>Calm, compact care routes.</h2>
            <p>
              Cluster patient visits into clean geographic tours — plan
              rosters, balance shifts and map every nurse&apos;s day.
            </p>
          </div>

          <svg
            className="login-illus"
            viewBox="0 0 300 150"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="78" cy="70" r="44" />
            <circle cx="214" cy="84" r="50" />
            <path
              className="login-route"
              d="M40 104 C 62 66 78 58 96 60 C 124 64 132 96 150 100 C 178 106 192 56 214 50 C 240 44 252 88 268 96"
            />
            {STOPS.map(([x, y], i) => (
              <g
                key={i}
                className="login-stop"
                transform={`translate(${x} ${y})`}
              >
                <circle r="11" />
                <text x="0" y="3.6">
                  {i + 1}
                </text>
              </g>
            ))}
            <g className="login-pin" transform="translate(268 96)">
              <circle r="11" />
              <path d="M0 -4.4 C -2 -7 -6 -5.4 -6 -2 C -6 1.6 0 5 0 5 C 0 5 6 1.6 6 -2 C 6 -5.4 2 -7 0 -4.4 Z" />
            </g>
          </svg>

          <ul className="login-points">
            <li>Auto-planned daily &amp; weekly nurse tours</li>
            <li>Real road travel times &amp; shift insight</li>
          </ul>
        </aside>

        <form className="login-form" onSubmit={submit}>
          <h1>Welcome back</h1>
          <p className="login-sub">Sign in to continue to your planner.</p>

          <div className="field">
            <label>Username</label>
            <div className="login-input">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2" />
              </svg>
              <input
                type="text"
                value={username}
                autoFocus
                autoComplete="username"
                placeholder="Enter your username"
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError(false);
                }}
              />
            </div>
          </div>

          <div className="field">
            <label>Password</label>
            <div className="login-input">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
                <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
              </svg>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                placeholder="Enter your password"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(false);
                }}
              />
            </div>
          </div>

          {error && (
            <div className="status err">Incorrect username or password.</div>
          )}

          <button type="submit" className="btn-go login-btn">
            Sign in
          </button>

          <p className="login-note">
            Protected demo access · Outpatient touring planner
          </p>
        </form>
      </div>
    </div>
  );
}
