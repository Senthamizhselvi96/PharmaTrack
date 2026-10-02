import { useEffect, useState } from 'react';
import { api } from './api.js';

export default function PharmacyInventory({ auth, socket, onLogout }) {
  const [inventory, setInventory] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [medicine, setMedicine] = useState('');
  const [generic, setGeneric] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState('');
  const token = auth.token;

  const loadInventory = async () => {
    try {
      const data = await api('/pharmacy/inventory', { token });
      setInventory(data);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const loadReservations = async () => {
    try {
      const data = await api('/pharmacy/reservations', { token });
      setReservations(data);
    } catch (err) {
      setMessage(err.message);
    }
  };

  useEffect(() => {
    loadInventory();
    loadReservations();

    const refreshInventory = () => {
      loadInventory();
      loadReservations();
    };

    socket.on('inventory:updated', refreshInventory);
    socket.on('reservation:updated', refreshInventory);

    return () => {
      socket.off('inventory:updated', refreshInventory);
      socket.off('reservation:updated', refreshInventory);
    };
  }, []);

  const addMedicine = async (e) => {
    e.preventDefault();
    setMessage('');

    try {
      await api('/pharmacy/inventory', {
        method: 'POST',
        token,
        body: {
          medicine,
          generic,
          quantity: Number(quantity),
          price: Number(price)
        }
      });

      setMedicine('');
      setGeneric('');
      setQuantity(0);
      setPrice('');

      await loadInventory();

      setMessage('Medicine added successfully.');
    } catch (err) {
      setMessage(err.message);
    }
  };

  const updateStock = async (id, newQuantity) => {
    if (newQuantity < 0) return;

    try {
      await api(`/pharmacy/inventory/${id}`, {
        method: 'PATCH',
        token,
        body: {
          quantity: newQuantity
        }
      });

      await loadInventory();
      setMessage('Stock updated.');
    } catch (err) {
      setMessage(err.message);
    }
  };

  const updateReservation = async (id, status) => {
    try {
      await api(`/pharmacy/reservations/${id}`, {
        method: 'PATCH',
        token,
        body: { status }
      });

      await loadReservations();
      setMessage(`Reservation marked as ${status}.`);
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <div className="app-shell">

      <header className="topbar">
        <button className="brand">PharmaFind</button>

        <div className="user-nav">
          <span>Hi, {auth.name}</span>
          <button onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="content-wrap">

        <div className="dashboard-head">
          <div>
            <p className="eyebrow">PHARMACY DASHBOARD</p>
            <h1>Manage your medicine inventory.</h1>
            <p className="muted">
              Keep your stock updated so patients can find available medicines
              before visiting your pharmacy.
            </p>
          </div>
        </div>

        {message && (
          <p className="note">
            {message}
          </p>
        )}

        {/* ADD MEDICINE */}

        <section className="panel">

          <h2>Add medicine</h2>

          <form onSubmit={addMedicine} className="inventory-form">

            <input
              value={medicine}
              onChange={(e) => setMedicine(e.target.value)}
              placeholder="Medicine name"
              required
            />

            <input
              value={generic}
              onChange={(e) => setGeneric(e.target.value)}
              placeholder="Generic name"
            />

            <input
              type="number"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Quantity"
              required
            />

            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Price"
              required
            />

            <button type="submit">
              Add medicine
            </button>

          </form>

        </section>

        {/* INVENTORY */}

        <section className="panel">

          <h2>Current inventory</h2>

          {inventory.length === 0 ? (
            <div className="empty">
              No medicines have been added yet.
            </div>
          ) : (
            <div className="inventory-list">

              {inventory.map((item) => (

                <div className="inventory-card" key={item._id}>

                  <div>
                    <h3>{item.medicine}</h3>

                    <p>
                      {item.generic || 'Generic name not provided'}
                    </p>

                    <p className="muted">
                      ₹{item.price ?? '—'}
                    </p>
                  </div>

                  <div className="stock-control">

                    <button
                      onClick={() =>
                        updateStock(item._id, item.quantity - 1)
                      }
                    >
                      −
                    </button>

                    <strong>
                      {item.quantity}
                    </strong>

                    <button
                      onClick={() =>
                        updateStock(item._id, item.quantity + 1)
                      }
                    >
                      +
                    </button>

                  </div>

                </div>

              ))}

            </div>
          )}

        </section>

        {/* RESERVATIONS */}

        <section className="panel">

          <h2>Patient reservations</h2>

          {reservations.length === 0 ? (
            <div className="empty">
              No reservations yet.
            </div>
          ) : (

            <div className="reservation-list">

              {reservations.map((reservation) => (

                <div
                  className="reservation-card"
                  key={reservation._id}
                >

                  <div>

                    <h3>
                      {reservation.stock?.medicine}
                    </h3>

                    <p>
                      Patient: {reservation.patientName}
                    </p>

                    <p>
                      Phone: {reservation.patientPhone}
                    </p>

                    <p>
                      Quantity: {reservation.quantity}
                    </p>

                  </div>

                  <div className="reservation-right">

                    <span
                      className={`status ${reservation.status}`}
                    >
                      {reservation.status}
                    </span>

                    {reservation.status === 'held' && (
                      <button
                        onClick={() =>
                          updateReservation(
                            reservation._id,
                            'ready'
                          )
                        }
                      >
                        Mark ready
                      </button>
                    )}

                    {reservation.status === 'ready' && (
                      <button
                        onClick={() =>
                          updateReservation(
                            reservation._id,
                            'collected'
                          )
                        }
                      >
                        Mark collected
                      </button>
                    )}

                  </div>

                </div>

              ))}

            </div>

          )}

        </section>

      </main>

    </div>
  );
}