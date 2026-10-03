import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';


export default function Patient({ auth, socket, onLogout }) {
  const [profile, setProfile] = useState(null);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState({ lat: 13.0827, lng: 80.2707 });
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('search');
  const [reservations, setReservations] = useState([]);
  const token = auth.token;
  const posRef = useRef(null);       // last known real location
  const lastQuery = useRef('');      // last submitted search term (avoids stale state in socket handlers)

  const locate = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Your browser does not support location access.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error('Location access is needed to find nearby pharmacies. Please allow it in your browser and search again.')),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  const runSearch = async (term, refresh = false) => {
    try {
      if (!refresh || !posRef.current) { posRef.current = await locate(); setPos(posRef.current); }
      const here = posRef.current;
      setResults(await api(`/search?q=${encodeURIComponent(term)}&lat=${here.lat}&lng=${here.lng}`));
    } catch (err) { setMsg(err.message); }
  };

  const search = async e => {
    e?.preventDefault(); setMsg('');
    lastQuery.current = q.trim();
    await runSearch(lastQuery.current);
  };

  const loadReservations = async () => {
    try { setReservations(await api('/patient/reservations', { token })); } catch (e) { setMsg(e.message); }
  };
  const loadProfile = async () => {
  try {
    setProfile(await api('/patient/profile', { token }));
  } catch (e) {
    setMsg(e.message);
  }
};

  useEffect(() => {
    const refresh = () => { if (lastQuery.current) runSearch(lastQuery.current, true); loadReservations(); };
    socket.on('inventory:updated', refresh);
    socket.on('reservation:updated', refresh);
    loadReservations();
    return () => { socket.off('inventory:updated', refresh); socket.off('reservation:updated', refresh); };
  }, [socket]);

  const reserve = async r => {
    setMsg('');
    try {
      await api('/reservations', { method: 'POST', token, body: { stockId: r.stock._id, quantity } });
      setQuantity(1); setActive(null);
      await runSearch(lastQuery.current, true); await loadReservations();
      setMsg(`Reserved ${quantity} × ${r.stock.medicine} at ${r.pharmacy.name}. Collect within 2 hours.`);
    } catch (err) { setMsg(err.message); }
  };

  const cancel = async id => {
    try { await api(`/patient/reservations/${id}/cancel`, { method: 'PATCH', token }); await loadReservations(); }
    catch (e) { setMsg(e.message); }
  };

  const dir = p => `https://www.google.com/maps/dir/?api=1&destination=${p.location.coordinates[1]},${p.location.coordinates[0]}`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand">PharmaTrack</button>
        <div className="user-nav"><span>Hi, {auth.name}</span><button onClick={onLogout}>Log out</button></div>
      </header>
      <div className="dashboard-head">
        <div><p className="eyebrow">PATIENT DASHBOARD</p><h1>Find your medicine before you visit.</h1></div>
      <div className="tabs">
  <button
    className={tab === 'search' ? 'tab active' : 'tab'}
    onClick={() => setTab('search')}
  >
    Search
  </button>

  <button
    className={tab === 'reservations' ? 'tab active' : 'tab'}
    onClick={() => {
      setTab('reservations');
      loadReservations();
    }}
  >
    My reservations
  </button>

  <button
  className={tab === 'profile' ? 'tab active' : 'tab'}
  onClick={() => {
    setTab('profile');
    loadProfile();
    loadReservations();
  }}
>
  Profile
</button>
</div>
</div>

      {tab === 'search' ? (
        <main className="patient-layout">
          <section className="results-panel">
            <form onSubmit={search} className="search-box"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search medicine by name or generic name" required /><button>Search nearby</button></form>
            <p className="location-note">📍 Searching within 10 km of your current location. Your browser will ask for location permission.</p>
            {msg && <p className="note">{msg}</p>}
            <div className="result-title">{results.length ? `${results.length} pharmacies with stock` : 'Search results'}</div>
            {results.length === 0 && <div className="empty">Search for a medicine to see nearby registered pharmacies with available stock.</div>}
            {results.map(r => (
              <article className="result-card" key={r.stock._id}>
                <div className="result-main">
                  <div><h3>{r.stock.medicine}</h3><p>{r.stock.generic || 'Generic name not provided'} · ₹{r.stock.price ?? '—'}</p></div>
                  <span className="stock-badge">{r.stock.quantity} available</span>
                </div>
                <h4>{r.pharmacy.name}</h4>
                <p className="muted">📍 {r.distanceKm} km · {r.pharmacy.address}</p>
                <div className="card-actions"><a href={dir(r.pharmacy)} target="_blank" rel="noreferrer">View directions</a><button onClick={() => { setActive(active === r.stock._id ? null : r.stock._id); setQuantity(1); }}>Reserve</button></div>
                {active === r.stock._id && <div className="reserve-row"><label>Quantity<input type="number" min="1" max={r.stock.quantity} value={quantity} onChange={e => setQuantity(Math.max(1, Math.min(r.stock.quantity, Number(e.target.value))))} /></label><button onClick={() => reserve(r)}>Confirm reservation</button></div>}
              </article>
            ))}
          </section>
          <section className="map-panel">
            <div className="map-placeholder">
              Pharmacy locations are shown in the search results below.
              </div>
              </section>
              </main>
      ) : tab === 'reservations' ? (
        <main className="content-wrap">
          <section className="panel">
            <h2>My reservations</h2>

            {reservations.length === 0 && (
              <div className="empty">You have no reservations yet.</div>
            )}

            {reservations.map(r => (
              <div className="reservation-card" key={r._id}>
                <div>
                  <h3>{r.stock?.medicine}</h3>
                  <p>{r.pharmacy?.name} · Quantity {r.quantity}</p>
                  <p className="muted">{r.pharmacy?.address}</p>
                </div>

                <div className="reservation-right">
                  <span className={`status ${r.status}`}>
                    {r.status.replace('_', ' ')}
                  </span>

                  {['held', 'confirmed'].includes(r.status) && (
                    <button
                      className="danger-button"
                      onClick={() => cancel(r._id)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </section>
        </main>
       ) : (
  <main className="content-wrap">
    <section className="panel">
      <h2>Profile</h2>

      {profile && (
        <div className="profile-card">
          <h3>{profile.name}</h3>

          <p>
            <strong>Email:</strong> {profile.email}
          </p>

          <p>
            <strong>Phone:</strong> {profile.phone}
          </p>

          <p>
            <strong>Account created:</strong>{' '}
            {new Date(profile.createdAt).toLocaleDateString()}
          </p>
        </div>
      )}

      <h2>Reservation history</h2>

      {reservations.length === 0 ? (
        <div className="empty">
          No reservation history yet.
        </div>
      ) : (
        reservations.map(r => (
          <div className="reservation-card" key={r._id}>
            <div>
              <h3>{r.stock?.medicine}</h3>

              <p>
                {r.pharmacy?.name} · Quantity {r.quantity}
              </p>

              <p className="muted">
                {r.pharmacy?.address}
              </p>

              <p className="muted">
                Reserved on:{' '}
                {new Date(r.createdAt).toLocaleDateString()}
              </p>
            </div>

            <div className="reservation-right">
              <span className={`status ${r.status}`}>
                {r.status.replace('_', ' ')}
              </span>
            </div>
          </div>
        ))
      )}
    </section>
  </main>
)}
    </div>
  );
}
