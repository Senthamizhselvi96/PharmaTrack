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
    const next = {
      token: data.token,
      role: data.role,
      name: data.name,
      id: data.id,
      email: data.email,
      pharmacyId: data.pharmacy?.id || data.pharmacyId,
      branch: data.branch || null
    };
    localStorage.setItem('pf_auth', JSON.stringify(next));
    localStorage.setItem('pf_token', data.token);
    setAuth(next);
  };

  if (auth && !socket) return null;
  if (auth?.role === 'patient') return <Patient auth={auth} socket={socket} onLogout={logout} />;
  if (auth?.role === 'pharmacy' || auth?.role === 'staff') return <Dashboard auth={auth} socket={socket} onLogout={logout} />;

  return (
    <div className="app-shell">
      <header className="topbar">
  <button className="brand" onClick={() => setScreen('home')}>
    <img
      src="/pharmatrack-logo.png"
      alt="PharmaTrack"
      className="brand-logo"
    />
  </button>

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
  const [staffLogin, setStaffLogin] = useState(false);
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [locationMode, setLocationMode] = useState('address');

  const set = key => e => { const value = e.target.value; setForm(f => ({ ...f, [key]: value })); };
  
const useMyLocation = () => {
  if (!navigator.geolocation) {
    setErr('Location is not supported by this browser');
    return;
  }

  setErr('');
  setBusy(true);

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);

      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`
        );

        if (!response.ok) {
          throw new Error('Address lookup failed');
        }

        const data = await response.json();

        const address = data.display_name || '';

        setForm(f => ({
          ...f,
          lat,
          lng,
          address
        }));

        setLocationMode('current');

        if (!address) {
          setErr(
            'Location detected, but address was not found. Please enter the address manually.'
          );
        }
      } catch (error) {
        setForm(f => ({
          ...f,
          lat,
          lng
        }));

        setLocationMode('current');

        setErr(
          'GPS location detected, but address lookup failed. Please enter the address manually.'
        );
      } finally {
        setBusy(false);
      }
    },
    () => {
      setErr(
        'Could not get your location. Please allow location access.'
      );
      setBusy(false);
    },
    {
      enableHighAccuracy: true,
      timeout: 15000
    }
  );


  setErr('');
  setLocationMode('current');

  navigator.geolocation.getCurrentPosition(
    p => {
      setForm(f => ({
        ...f,
        lat: p.coords.latitude.toFixed(6),
        lng: p.coords.longitude.toFixed(6)
      }));
    },
    () => {
      setErr('Could not get your location. Please allow location access or use the address option.');
      setLocationMode('address');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};
  const submit = async e => {
  e.preventDefault();
  setErr('');
  setBusy(true);

  try {
    let endpoint = `/auth/${role}/${mode}`;
    if (!isPatient && mode === 'login' && staffLogin) {
      endpoint = '/auth/staff/login';
    }
    const { api } = await import('./api.js');

    const requestForm = {
      ...form,
      ...(mode === 'register'
        ? { locationMode }
        : {})
    };

    const data = await api(endpoint, {
      method: 'POST',
      body: requestForm
    });

    onLogin(data);
  } catch (e2) {
    setErr(e2.message);
  } finally {
    setBusy(false);
  }
};
  return (
    <div className="modal-backdrop">
      <section className="auth-card">
        <button className="close" onClick={onClose}>×</button>
        <p className="eyebrow">{isPatient ? 'PATIENT ACCESS' : staffLogin && mode === 'login' ? 'BRANCH STAFF ACCESS' : 'PHARMACY ACCESS'}</p>
        <h2>
          {mode === 'login'
            ? isPatient
              ? 'Patient Login'
              : staffLogin
                ? 'Branch staff login'
                : 'Pharmacy owner login'
            : isPatient
              ? 'Register as a patient'
              : 'Register your pharmacy'}
        </h2>

        {!isPatient && mode === 'login' && (
          <div className="auth-role-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              type="button"
              className={!staffLogin ? 'tab active' : 'tab'}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '8px',
                border: !staffLogin ? '2px solid var(--pine)' : '1px solid var(--line)',
                background: !staffLogin ? 'var(--mint)' : '#fff',
                color: !staffLogin ? 'var(--pine2)' : 'var(--muted)',
                fontWeight: 750,
                cursor: 'pointer'
              }}
              onClick={() => { setStaffLogin(false); setErr(''); }}
            >
              🏥 Pharmacy Owner
            </button>
            <button
              type="button"
              className={staffLogin ? 'tab active' : 'tab'}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '8px',
                border: staffLogin ? '2px solid var(--pine)' : '1px solid var(--line)',
                background: staffLogin ? 'var(--mint)' : '#fff',
                color: staffLogin ? 'var(--pine2)' : 'var(--muted)',
                fontWeight: 750,
                cursor: 'pointer'
              }}
              onClick={() => { setStaffLogin(true); setErr(''); }}
            >
              👤 Branch Staff
            </button>
          </div>
        )}

        <form onSubmit={submit} className="form-grid">
          {mode === 'register' && isPatient && <>
            <label>Full name<input onChange={set('name')} required /></label>
            <label>Phone number<input onChange={set('phone')} required /></label>
            <label>
              Address
              <input
                type="text"
                value={form.address || ''}
                onChange={set('address')}
                placeholder="Enter or detect patient address"
                required
              />
            </label>
            <div className="location-options">
              <button type="button" onClick={useMyLocation}>
                📍 Use my current location
              </button>

              {locationMode === 'current' && form.lat && form.lng && (
                <small className="hint">✓ Current location selected</small>
              )}
            </div>
          </>}
          {mode === 'register' && !isPatient && <>
            <label>Pharmacy name<input onChange={set('name')} required /></label>
            <label>Owner / pharmacist name<input onChange={set('ownerName')} /></label>
            <label>Phone number<input onChange={set('phone')} /></label>
            <label>
  Address
  <input
    type="text"
    value={form.address || ''}
    onChange={set('address')}
    placeholder="Enter or detect pharmacy address"
    required
  />
</label>
            <div className="location-options">
  <button type="button" onClick={useMyLocation}>
    📍 Use my current location
  </button>

  {locationMode === 'current' && form.lat && form.lng && (
    <small className="hint">✓ Current location selected</small>
  )}

</div>
</>}
          <label>Email<input type="email" onChange={set('email')} required /></label>
          <label>Password<input type="password" minLength={mode === 'register' ? 6 : undefined} onChange={set('password')} required /></label>
          {err && <div className="error-box">{err}</div>}
          <button disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? (isPatient ? 'Log in as Patient' : staffLogin ? 'Log in as Staff' : 'Log in as Owner') : 'Create account'}
          </button>
        </form>
        {(!staffLogin || mode !== 'login') && (
          <button className="text-button" onClick={() => { setErr(''); setMode(mode === 'login' ? 'register' : 'login'); }}>
            {mode === 'login' ? `New ${isPatient ? 'patient' : 'pharmacy'}? Register` : 'Already have an account? Log in'}
          </button>
        )}


      </section>
    </div>
  );
}
