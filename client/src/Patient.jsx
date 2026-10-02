import { useEffect, useMemo, useState } from 'react';
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF } from '@react-google-maps/api';
import { api } from './api.js';

export default function Patient({ auth, socket, onLogout }) {
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY });
  const [q, setQ] = useState('');
  const [pos, setPos] = useState({ lat: 13.0827, lng: 80.2707 });
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('search');
  const [reservations, setReservations] = useState([]);
  const token = auth.token;

  const locate = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(pos);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(pos),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  const search = async e => {
    e?.preventDefault(); setMsg('');
    const here = await locate(); setPos(here);
    try { setResults(await api(`/search?q=${encodeURIComponent(q)}&lat=${here.lat}&lng=${here.lng}`)); }
    catch (err) { setMsg(err.message); }
  };

  const loadReservations = async () => {
    try { setReservations(await api('/patient/reservations', { token })); } catch (e) { setMsg(e.message); }
  };

  useEffect(() => {
    socket.emit('join:patient', auth.id);
    const refresh = () => { if (q.trim()) search(); loadReservations(); };
    socket.on('inventory:updated', refresh);
    socket.on('reservation:updated', refresh);
    loadReservations();
    return () => { socket.off('inventory:updated', refresh); socket.off('reservation:updated', refresh); socket.disconnect(); };
  }, []);

  const reserve = async r => {
    setMsg('');
    try {
      await api('/reservations', { method: 'POST', token, body: { stockId: r.stock._id, quantity } });
      setQuantity(1); setActive(null);
      await search(); await loadReservations();
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
        <button className="brand">PharmaFind</button>
        <div className="user-nav"><span>Hi, {auth.name}</span><button onClick={onLogout}>Log out</button></div>
      </header>
      <div className="dashboard-head">
        <div><p className="eyebrow">PATIENT DASHBOARD</p><h1>Find your medicine before you visit.</h1></div>
        <div className="tabs"><button className={tab === 'search' ? 'tab active' : 'tab'} onClick={() => setTab('search')}>Search</button><button className={tab === 'reservations' ? 'tab active' : 'tab'} onClick={() => { setTab('reservations'); loadReservations(); }}>My reservations</button></div>
      </div>

      {tab === 'search' ? (
        <main className="patient-layout">
          <section className="results-panel">
            <form onSubmit={search} className="search-box"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search medicine by name or generic name" required /><button>Search nearby</button></form>
            <p className="location-note">📍 Searching within 10 km of your current location. If location access is unavailable, Chennai is used as the demo fallback.</p>
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
            {isLoaded ? <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }} center={pos} zoom={12}>
              <MarkerF position={pos} title="Your location" />
              {results.map(r => {
                const [lng, lat] = r.pharmacy.location.coordinates;
                return <MarkerF key={r.stock._id} position={{ lat, lng }} onClick={() => setActive(r.stock._id)} label={String(r.stock.quantity)} />;
              })}
              {active && results.find(r => r.stock._id === active) && (() => { const r = results.find(x => x.stock._id === active); const [lng, lat] = r.pharmacy.location.coordinates; return <InfoWindowF position={{ lat, lng }} onCloseClick={() => setActive(null)}><div><strong>{r.pharmacy.name}</strong><br />{r.stock.medicine}: {r.stock.quantity} available<br />{r.distanceKm} km away</div></InfoWindowF>; })()}
            </GoogleMap> : <div className="map-placeholder">Loading Google Maps…</div>}
          </section>
        </main>
      ) : (
        <main className="content-wrap">
          <section className="panel"><h2>My reservations</h2>
            {reservations.length === 0 && <div className="empty">You have no reservations yet.</div>}
            {reservations.map(r => <div className="reservation-card" key={r._id}>
              <div><h3>{r.stock?.medicine}</h3><p>{r.pharmacy?.name} · Quantity {r.quantity}</p><p className="muted">{r.pharmacy?.address}</p></div>
              <div className="reservation-right"><span className={`status ${r.status}`}>{r.status.replace('_',' ')}</span>{r.status === 'held' && <button className="danger-button" onClick={() => cancel(r._id)}>Cancel</button>}</div>
            </div>)}
          </section>
        </main>
      )}
    </div>
  );
}
