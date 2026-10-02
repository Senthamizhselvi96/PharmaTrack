import { useEffect, useState } from 'react';
import { api } from './api.js';

const blank = { medicine: '', generic: '', quantity: 0, price: '' };

export default function Dashboard({ auth, socket, onLogout }) {
  const [stock, setStock] = useState([]);
  const [resv, setResv] = useState([]);
  const [item, setItem] = useState(blank);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const token = auth.token;

  const load = async () => {
    const [s, r] = await Promise.all([
      api('/pharmacy/stock', { token }),
      api('/pharmacy/reservations', { token })
    ]);
    setStock(s); setResv(r);
  };

  useEffect(() => {
    load().catch(e => setErr(e.message));
    socket.emit('join:pharmacy', auth.id);
    const refresh = () => load().catch(e => setErr(e.message));
    socket.on('reservation:new', refresh);
    socket.on('reservation:updated', refresh);
    socket.on('stock:updated', refresh);
    return () => { socket.off('reservation:new', refresh); socket.off('reservation:updated', refresh); socket.off('stock:updated', refresh); socket.disconnect(); };
  }, []);

  const save = async e => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/pharmacy/stock', { method: 'PUT', token, body: item }); setItem(blank); await load(); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  const status = async (id, value) => {
    try { await api(`/pharmacy/reservations/${id}/status`, { method: 'PATCH', token, body: { status: value } }); await load(); }
    catch (e) { setErr(e.message); }
  };

  const totalStock = stock.reduce((n, s) => n + s.quantity, 0);
  const pending = resv.filter(r => ['held','confirmed','ready'].includes(r.status)).length;

  return (
    <div className="app-shell">
      <header className="topbar"><button className="brand">PharmaFind</button><div className="user-nav"><span>🏥 {auth.name}</span><button onClick={onLogout}>Log out</button></div></header>
      <div className="dashboard-head"><div><p className="eyebrow">PHARMACY DASHBOARD</p><h1>Manage your live inventory.</h1></div></div>
      <main className="content-wrap">
        <div className="stats"><div><strong>{stock.length}</strong><span>Medicines</span></div><div><strong>{totalStock}</strong><span>Total units</span></div><div><strong>{pending}</strong><span>Active reservations</span></div><div><strong>{stock.filter(s => s.quantity > 0).length}</strong><span>In stock</span></div></div>
        {err && <p className="note">{err}</p>}
        <div className="two-panels">
          <section className="panel"><div className="panel-head"><div><p className="eyebrow">INVENTORY</p><h2>Add or update stock</h2></div></div>
            <form onSubmit={save} className="form-grid">
              <label>Medicine name<input value={item.medicine} onChange={e => setItem({ ...item, medicine: e.target.value })} placeholder="Paracetamol 500mg" required /></label>
              <label>Generic name<input value={item.generic} onChange={e => setItem({ ...item, generic: e.target.value })} placeholder="Paracetamol" /></label>
              <div className="two-col"><label>Quantity<input type="number" min="0" value={item.quantity} onChange={e => setItem({ ...item, quantity: Number(e.target.value) })} /></label><label>Price ₹<input type="number" min="0" step="0.01" value={item.price} onChange={e => setItem({ ...item, price: e.target.value })} /></label></div>
              <button disabled={busy}>{busy ? 'Saving…' : 'Save stock'}</button>
            </form>
            <div className="table-wrap"><table><thead><tr><th>Medicine</th><th>Stock</th><th>Price</th></tr></thead><tbody>{stock.map(s => <tr key={s._id} onClick={() => setItem({ ...s, price: s.price ?? '' })}><td>{s.medicine}<small>{s.generic}</small></td><td className={s.quantity === 0 ? 'low' : ''}>{s.quantity}</td><td>₹{s.price ?? '—'}</td></tr>)}</tbody></table></div>
          </section>
          <section className="panel"><div className="panel-head"><div><p className="eyebrow">RESERVATIONS</p><h2>Patient requests</h2></div></div>
            {resv.length === 0 && <div className="empty">No reservations yet.</div>}
            {resv.map(r => <div className="reservation-card" key={r._id}><div><h3>{r.stock?.medicine} × {r.quantity}</h3><p>{r.patientName} · {r.patientPhone}</p><p className="muted">{new Date(r.createdAt).toLocaleString()}</p></div><div className="reservation-right"><span className={`status ${r.status}`}>{r.status}</span>{r.status === 'held' && <button onClick={() => status(r._id,'confirmed')}>Confirm</button>}{r.status === 'confirmed' && <button onClick={() => status(r._id,'ready')}>Ready</button>}{r.status === 'ready' && <button onClick={() => status(r._id,'collected')}>Collected</button>}</div></div>)}
          </section>
        </div>
      </main>
    </div>
  );
}
