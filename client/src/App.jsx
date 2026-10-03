import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import Patient from './Patient.jsx';
import Dashboard from './Dashboard.jsx';
import './styles.css';

const SOCKET_URL = import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, '') || 'http://localhost:5000';

export default function App() {
  const [screen, setScreen] = useState('home');
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pf_auth')) || null; } catch { return null; }
  });

  // One authenticated socket per login session
  const [socket, setSocket] = useState(null);
  useEffect(() => {
    if (!auth?.token) { setSocket(null); return; }
    const s = io(SOCKET_URL, { auth: { token: auth.token } });
    setSocket(s);
    return () => s.disconnect();
  }, [auth?.token]);

  useEffect(() => {
    const onPop = () => setScreen('home');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const logout = () => {
    localStorage.removeItem('pf_auth');
    localStorage.removeItem('pf_token');
    setAuth(null);
    setScreen('home');
  };

  const login = data => {
    const next = { token: data.token, role: data.role, name: data.name, id: data.id };
    localStorage.setItem('pf_auth', JSON.stringify(next));
    localStorage.setItem('pf_token', data.token);
    setAuth(next);
  };

  if (auth && !socket) return null;
  if (auth?.role === 'patient') return <Patient auth={auth} socket={socket} onLogout={logout} />;
  if (auth?.role === 'pharmacy') return <Dashboard auth={auth} socket={socket} onLogout={logout} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen('home')}>PharmaTrack</button>
        <span className="tagline">Find medicine before you visit.</span>
      </header>

      <main className="landing">
        <section className="hero">
          <p className="eyebrow">REAL-TIME PHARMACY AVAILABILITY</p>
          <h1>Find your medicine.<br /><span>Reserve before you go.</span></h1>
          <p className="hero-copy">Search nearby pharmacies, check live stock, see distance on Google Maps, and reserve your medicine before leaving home.</p>
        </section>

        <section className="role-grid">
          <RoleCard icon="👤" title="Patient / User" text="Search nearby medicines, compare availability and reserve stock." onClick={() => setScreen('patient-auth')} />
          <RoleCard icon="🏥" title="Pharmacy" text="Manage your inventory and receive patient reservations in real time." onClick={() => setScreen('pharmacy-auth')} />
        </section>

        {screen === 'patient-auth' && <AuthCard role="patient" onLogin={login} onClose={() => setScreen('home')} />}
        {screen === 'pharmacy-auth' && <AuthCard role="pharmacy" onLogin={login} onClose={() => setScreen('home')} />}
      </main>
    </div>
  );
}

function RoleCard({ icon, title, text, onClick }) {
  return <button className="role-card" onClick={onClick}><div className="role-icon">{icon}</div><h2>{title}</h2><p>{text}</p><span className="role-link">Continue →</span></button>;
}

function AuthCard({ role, onLogin, onClose }) {
  const isPatient = role === 'patient';
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const set = key => e => { const value = e.target.value; setForm(f => ({ ...f, [key]: value })); };
  const useMyLocation = () => {
    if (!navigator.geolocation) return setErr('Location is not supported by this browser');
    setErr('');
    navigator.geolocation.getCurrentPosition(
      p => setForm(f => ({ ...f, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })),
      () => setErr('Could not get your location. Allow location access or enter the coordinates manually.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const endpoint = `/auth/${role}/${mode}`;
      const { api } = await import('./api.js');
      const data = await api(endpoint, { method: 'POST', body: form });
      onLogin(data);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop">
      <section className="auth-card">
        <button className="close" onClick={onClose}>×</button>
        <p className="eyebrow">{isPatient ? 'PATIENT ACCESS' : 'PHARMACY ACCESS'}</p>
        <h2>{mode === 'login' ? `${isPatient ? 'Patient' : 'Pharmacy'} login` : `Register ${isPatient ? 'as a patient' : 'your pharmacy'}`}</h2>
        <form onSubmit={submit} className="form-grid">
          {mode === 'register' && isPatient && <>
            <label>Full name<input onChange={set('name')} required /></label>
            <label>Phone number<input onChange={set('phone')} required /></label>
          </>}
          {mode === 'register' && !isPatient && <>
            <label>Pharmacy name<input onChange={set('name')} required /></label>
            <label>Owner / pharmacist name<input onChange={set('ownerName')} /></label>
            <label>Phone number<input onChange={set('phone')} /></label>
            <label>Address<input onChange={set('address')} required /></label>
            <button type="button" onClick={useMyLocation}>📍 Use my current location</button>
            <div className="two-col"><label>Latitude<input type="number" step="any" value={form.lat ?? ''} onChange={set('lat')} required /></label><label>Longitude<input type="number" step="any" value={form.lng ?? ''} onChange={set('lng')} required /></label></div>
            <small className="hint">Stand inside the pharmacy when you tap the button for an accurate location, or paste coordinates from Google Maps.</small>
          </>}
          <label>Email<input type="email" onChange={set('email')} required /></label>
          <label>Password<input type="password" minLength={mode === 'register' ? 6 : undefined} onChange={set('password')} required /></label>
          {err && <div className="error-box">{err}</div>}
          <button disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
        <button className="text-button" onClick={() => { setErr(''); setMode(mode === 'login' ? 'register' : 'login'); }}>
          {mode === 'login' ? `New ${isPatient ? 'patient' : 'pharmacy'}? Register` : 'Already have an account? Log in'}
        </button>
      </section>
    </div>
  );
}
