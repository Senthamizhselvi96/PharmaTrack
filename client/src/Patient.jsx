import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import PharmacyLocationPicker from './PharmacyLocationPicker.jsx';
import { searchAddressWithFallback } from './geocoding.js';

const parseCoordinates = (loc) => {
  if (loc?.coordinates && Array.isArray(loc.coordinates) && loc.coordinates.length === 2) {
    const [lng, lat] = loc.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  return null;
};

export default function Patient({ auth, socket, onLogout }) {
  const [profile, setProfile] = useState(null);
  const [addressSaved, setAddressSaved] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [profileMsg, setProfileMsg] = useState({ type: '', text: '' });
  const [editingAddress, setEditingAddress] = useState(false);
  const [typedAddress, setTypedAddress] = useState('');
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [addressNeedsResolution, setAddressNeedsResolution] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [geocodeMsg, setGeocodeMsg] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [q, setQ] = useState('');
  const [locationMode, setLocationMode] = useState('current'); // 'current' | 'registered'
  const [pos, setPos] = useState(null);
  const [locStatus, setLocStatus] = useState('prompt'); // 'prompt' | 'detecting' | 'detected' | 'resolving' | 'registered' | 'fallback_registered' | 'denied' | 'unavailable' | 'missing_registered' | 'invalid_registered'
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingReservations, setLoadingReservations] = useState(true);
  const [active, setActive] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('search');
  const [reservations, setReservations] = useState([]);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const token = auth.token;
  const currentPosRef = useRef(null);
  const registeredCoordsRef = useRef(null);
  const lastQuery = useRef('');

  const geocodeAddress = async (address) => {
    const clean = String(address || '').trim();
    if (!clean) throw new Error('No address provided');

    // 1. Inspect existing Google Maps integration for an available geocoding method
    if (typeof window !== 'undefined' && window.google?.maps?.Geocoder) {
      try {
        const geocoder = new window.google.maps.Geocoder();
        const googleResult = await new Promise((resolve, reject) => {
          geocoder.geocode({ address: clean }, (results, status) => {
            if (status === 'OK' && results?.[0]?.geometry?.location) {
              resolve({
                lat: results[0].geometry.location.lat(),
                lng: results[0].geometry.location.lng()
              });
            } else {
              reject(new Error(status || 'Google geocode failed'));
            }
          });
        });
        return googleResult;
      } catch {
        // Fall back to OpenStreetMap / Nominatim
      }
    }

    // 2. OpenStreetMap Nominatim geocoding method
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(clean)}`,
      { headers: { 'Accept': 'application/json' } }
    );
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon)
      };
    }
    throw new Error(`Could not find coordinates for address "${clean}"`);
  };

  const resolveRegisteredLocation = async (patientProfile = profile) => {
    const address = patientProfile?.address?.trim();
    if (!address) return null;
    if (registeredCoordsRef.current && registeredCoordsRef.current.address === address) {
      return registeredCoordsRef.current.coords;
    }
    if (patientProfile?.location?.coordinates?.length === 2) {
      const [lng, lat] = patientProfile.location.coordinates;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const coords = { lat, lng };
        registeredCoordsRef.current = { address, coords };
        return coords;
      }
    }
    const coords = await geocodeAddress(address);
    registeredCoordsRef.current = { address, coords };
    return coords;
  };

  const locate = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      const err = new Error('Unable to detect your location.');
      err.code = 2;
      return reject(err);
    }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      err => {
        const error = new Error(
          err?.code === 1
            ? 'Location access denied. Enable location permission.'
            : 'Unable to detect your location.'
        );
        error.code = err?.code || 2;
        reject(error);
      },
      { enableHighAccuracy: false, timeout: 6000 }
    );
  });

  const selectCurrentLocation = async () => {
    setLocationMode('current');
    setMsg('');

    // If already detected in this session, reuse coordinates
    if (currentPosRef.current) {
      const coords = currentPosRef.current;
      setPos(coords);
      setLocStatus('detected');
      if (lastQuery.current) runSearch(lastQuery.current, false, coords);
      return;
    }

    setLocStatus('detecting');
    try {
      const p = await locate();
      currentPosRef.current = p;
      setPos(p);
      setLocStatus('detected');
      if (lastQuery.current) runSearch(lastQuery.current, false, p);
    } catch (err) {
      // Automatically fallback to registered location if valid coordinates are available
      try {
        const regCoords = await resolveRegisteredLocation();
        if (regCoords) {
          setPos(regCoords);
          setLocationMode('registered');
          setLocStatus('fallback_registered');
          if (lastQuery.current) runSearch(lastQuery.current, false, regCoords);
          return;
        }
      } catch {
        // Fallback failed as well
      }

      setPos(null);
      setLocStatus(err?.code === 1 ? 'denied' : 'unavailable');
    }
  };

  const selectRegisteredLocation = async () => {
    setLocationMode('registered');
    setMsg('');

    const address = profile?.address?.trim();
    if (!address) {
      setPos(null);
      setLocStatus('missing_registered');
      return;
    }

    setLocStatus('resolving');
    try {
      const coords = await resolveRegisteredLocation();
      setPos(coords);
      setLocStatus('registered');
      if (lastQuery.current) runSearch(lastQuery.current, false, coords);
    } catch {
      setPos(null);
      setLocStatus('invalid_registered');
    }
  };

  const runSearch = async (term, refresh = false, overridePos = null) => {
    const activePos = overridePos || pos;

    if (!activePos) {
      setMsg('Please select a valid location (Current Location or Registered Location) before searching.');
      return;
    }

    if (!refresh) setSearching(true);
    try {
      const res = await api(`/search?q=${encodeURIComponent(term)}&lat=${activePos.lat}&lng=${activePos.lng}`);
      setResults(res);
      setHasSearched(true);
    } catch (err) {
      setMsg(err.message);
    } finally {
      if (!refresh) setSearching(false);
    }
  };

  const search = async e => {
    e?.preventDefault();
    setMsg('');
    lastQuery.current = q.trim();
    await runSearch(lastQuery.current);
  };

  const loadReservations = async () => {
    try {
      setReservations(await api('/patient/reservations', { token }));
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoadingReservations(false);
    }
  };

  const loadProfile = async () => {
    try {
      const data = await api('/patient/profile', { token });
      setProfile(data);
      if (!editingAddress) {
        setTypedAddress(data?.address || '');
        setSelectedLocation(parseCoordinates(data?.location));
      }
      // Seamlessly initialize with registered location if address is present and no location set
      if (data?.address?.trim() && !currentPosRef.current) {
        try {
          const coords = await resolveRegisteredLocation(data);
          if (coords) {
            setPos(coords);
            setLocationMode('registered');
            setLocStatus('registered');
          }
        } catch {
          // Address couldn't be resolved yet
        }
      }
    } catch (e) {
      setMsg(e.message);
    }
  };

  const handleStartEditAddress = () => {
    setEditingAddress(true);
    setTypedAddress(profile?.address || '');
    setSelectedLocation(parseCoordinates(profile?.location));
    setAddressNeedsResolution(false);
    setProfileMsg({ type: '', text: '' });
    setGeocodeMsg('');
    setAddressSuggestions([]);
  };

  const handleAddressInputChange = (e) => {
    const nextVal = e.target.value;
    setTypedAddress(nextVal);
    setProfileMsg({ type: '', text: '' });
    setGeocodeMsg('');
    setAddressSuggestions([]);

    const currentSaved = String(profile?.address || '').trim();
    if (nextVal.trim() !== currentSaved) {
      setAddressNeedsResolution(true);
      // Never silently retain old coordinates when the address changes
      setSelectedLocation(null);
    } else {
      setAddressNeedsResolution(false);
      setSelectedLocation(parseCoordinates(profile?.location));
    }
  };

  const handleFindOnMap = async () => {
    const clean = String(typedAddress || '').trim();
    if (!clean) {
      setProfileMsg({ type: 'error', text: 'Please enter an address to find on the map.' });
      return;
    }

    setResolvingAddress(true);
    setProfileMsg({ type: '', text: '' });
    setGeocodeMsg('');
    setAddressSuggestions([]);

    try {
      const outcome = await searchAddressWithFallback(clean);
      if (!outcome.success || !outcome.results || outcome.results.length === 0) {
        setSelectedLocation(null);
        setAddressNeedsResolution(true);
        setGeocodeMsg(
          'Could not find this address on the map. Please refine the address or click the map directly to choose your location.'
        );
        return;
      }

      setAddressSuggestions(outcome.results);
      const top = outcome.results[0];
      const nextPos = { lat: top.lat, lng: top.lng };
      setSelectedLocation(nextPos);
      setAddressNeedsResolution(false);

      if (top.precision === 'exact') {
        setGeocodeMsg('✓ Exact location found and pinned on the map.');
      } else {
        setGeocodeMsg(
          `📍 Found location for "${top.matchedQuery}". Drag the marker or click the map if you wish to adjust the exact location.`
        );
      }
    } catch {
      setSelectedLocation(null);
      setAddressNeedsResolution(true);
      setGeocodeMsg('Address search failed. Please click on the map directly to choose your location.');
    } finally {
      setResolvingAddress(false);
    }
  };

  const handleLocationChange = (coords) => {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return;
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    setSelectedLocation({ lat, lng });
    setAddressNeedsResolution(false);
    setGeocodeMsg(`📍 Map location set to: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    setProfileMsg({ type: '', text: '' });
  };

  const handleSelectSuggestion = (item) => {
    setSelectedLocation({ lat: item.lat, lng: item.lng });
    setAddressNeedsResolution(false);
    setGeocodeMsg(`📍 Selected: ${item.matchedQuery}. You can refine by dragging the marker.`);
    setAddressSuggestions([]);
  };

  const handleSaveAddress = async () => {
    if (savingAddress) return;
    setProfileMsg({ type: '', text: '' });

    const cleanAddress = String(typedAddress || '').trim();
    if (!cleanAddress) {
      setProfileMsg({ type: 'error', text: 'Address is required.' });
      return;
    }

    if (addressNeedsResolution || !selectedLocation) {
      setProfileMsg({
        type: 'error',
        text: 'The address could not be resolved or coordinates are missing. Please click "Find on Map" or select a valid location on the map before saving.'
      });
      return;
    }

    const lat = Number(selectedLocation.lat);
    const lng = Number(selectedLocation.lng);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      setProfileMsg({
        type: 'error',
        text: 'Invalid coordinates. Please select a valid location on the map.'
      });
      return;
    }

    try {
      setSavingAddress(true);
      setAddressSaved(false);

      const updated = await api('/patient/profile', {
        method: 'PUT',
        token,
        body: {
          address: cleanAddress,
          coordinates: [lng, lat]
        }
      });

      // Update state with confirmed MongoDB values
      setProfile(updated);
      setEditingAddress(false);
      setAddressNeedsResolution(false);
      setAddressSuggestions([]);
      setGeocodeMsg('');

      // Update cached coordinates reference
      registeredCoordsRef.current = {
        address: cleanAddress,
        coords: { lat, lng }
      };

      // Ensure nearby search uses the updated coordinates
      if (locationMode === 'registered' || !pos) {
        setPos({ lat, lng });
        setLocStatus('registered');
        if (lastQuery.current) {
          runSearch(lastQuery.current, false, { lat, lng });
        }
      }

      setAddressSaved(true);
      setProfileMsg({
        type: 'success',
        text: 'Address and location updated successfully.'
      });

      setTimeout(() => {
        setAddressSaved(false);
        setProfileMsg(m => (m.type === 'success' ? { type: '', text: '' } : m));
      }, 4000);
    } catch (err) {
      setProfileMsg({
        type: 'error',
        text: err.message || 'Failed to update address.'
      });
    } finally {
      setSavingAddress(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingAddress(false);
    setAddressNeedsResolution(false);
    setTypedAddress(profile?.address || '');
    setSelectedLocation(parseCoordinates(profile?.location));
    setAddressSuggestions([]);
    setGeocodeMsg('');
    setProfileMsg({ type: '', text: '' });
  };

  useEffect(() => {
    loadProfile();
    const refresh = () => {
      if (lastQuery.current) runSearch(lastQuery.current, true);
      loadReservations();
    };
    socket.on('inventory:updated', refresh);
    socket.on('reservation:updated', refresh);
    loadReservations();
    return () => {
      socket.off('inventory:updated', refresh);
      socket.off('reservation:updated', refresh);
    };
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

  const dir = p => pos
    ? `https://www.google.com/maps/dir/?api=1&origin=${pos.lat},${pos.lng}&destination=${p.location.coordinates[1]},${p.location.coordinates[0]}`
    : `https://www.google.com/maps/dir/?api=1&destination=${p.location.coordinates[1]},${p.location.coordinates[0]}`;

  return (
    <div className="app-shell">
<header className="topbar patient-topbar">
  <div className="brand">
    <img
      src="/pharmatrack-logo.png"
      alt="PharmaTrack"
      className="brand-logo"
    />
  </div>

  <nav className="patient-nav" aria-label="Patient navigation">
    <button
      className={tab === 'search' ? 'patient-nav-link active' : 'patient-nav-link'}
      onClick={() => setTab('search')}
    >
      Nearby Pharmacies
    </button>

    <button
      className={tab === 'reservations' ? 'patient-nav-link active' : 'patient-nav-link'}
      onClick={() => {
        setTab('reservations');
        loadReservations();
      }}
    >
      My Reservations
    </button>
  </nav>

  <div className="profile-menu-wrap">
    <button
      type="button"
      className="profile-trigger"
      onClick={() => setProfileMenuOpen(open => !open)}
      aria-expanded={profileMenuOpen}
    >
      <span className="profile-avatar">
        {auth.name?.trim()?.charAt(0)?.toUpperCase() || 'U'}
      </span>
      <span>Profile</span>
      <span className="profile-arrow"></span>
    </button>

    {profileMenuOpen && (
      <div className="profile-dropdown">
        <button
          type="button"
          onClick={() => {
            setTab('profile');
            setProfileMenuOpen(false);
            loadProfile();
            loadReservations();
          }}
        >
          My Profile
        </button>

        <button type="button" onClick={onLogout}>
          Log out
        </button>
      </div>
    )}
  </div>
</header>

      <div className="dashboard-head">
        <div><p className="eyebrow">PATIENT DASHBOARD</p><h1>Find your medicine before you visit.</h1></div>
      </div>

      {tab === 'search' ? (
        <main className="patient-layout">
          <section className="results-panel">
            <form onSubmit={search} className="search-box">
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search medicine by name or generic name"
                required
              />
              <button>Search nearby</button>
            </form>

            <div className="location-control-section">
              <div className="location-mode-selector" role="group" aria-label="Location options">
                <button
                  type="button"
                  className={`location-mode-btn ${locationMode === 'current' ? 'active' : ''}`}
                  onClick={selectCurrentLocation}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="3 11 22 2 13 21 11 13 3 11" />
                  </svg>
                  Use Current Location
                </button>

                <button
                  type="button"
                  className={`location-mode-btn ${locationMode === 'registered' ? 'active' : ''}`}
                  onClick={selectRegisteredLocation}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                  Use Registered Location
                </button>
              </div>

              <div className={`location-status-bar ${locStatus}`} role="status" aria-live="polite">
                <div className="location-status-info">
                  <svg className="location-status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <div className="location-status-content">
                    {locStatus === 'prompt' && (
                      <span className="location-status-text">
                        Choose <strong>Current Location</strong> or <strong>Registered Location</strong> to find pharmacies within 10 km.
                      </span>
                    )}
                    {locStatus === 'detecting' && (
                      <span className="location-status-text">
                        <span className="loading-spinner-inline" /> Detecting your current location...
                      </span>
                    )}
                    {locStatus === 'resolving' && (
                      <span className="location-status-text">
                        <span className="loading-spinner-inline" /> Resolving registered location coordinates...
                      </span>
                    )}
                    {locStatus === 'detected' && pos && (
                      <span className="location-status-text">
                        <strong>Using Current Location</strong>
                        <span className="location-status-detail">
                          {' '}({pos.lat.toFixed(4)}, {pos.lng.toFixed(4)}) · Within 10 km
                        </span>
                      </span>
                    )}
                    {locStatus === 'registered' && pos && (
                      <span className="location-status-text">
                        <strong>Using Registered Location</strong>
                        <span className="location-status-detail">
                          : {profile?.address} ({pos.lat.toFixed(4)}, {pos.lng.toFixed(4)}) · Within 10 km
                        </span>
                      </span>
                    )}
                    {locStatus === 'fallback_registered' && pos && (
                      <span className="location-status-text">
                        <strong>Using Registered Location (Fallback)</strong>
                        <span className="location-status-detail">
                          : {profile?.address} · Current location access was denied
                        </span>
                      </span>
                    )}
                    {locStatus === 'denied' && (
                      <span className="location-status-text text-alert">
                        Location access denied. Please enable location permission or set an address in Profile.
                      </span>
                    )}
                    {locStatus === 'unavailable' && (
                      <span className="location-status-text text-alert">
                        Unable to detect your location. Please check browser permissions or set an address in Profile.
                      </span>
                    )}
                    {locStatus === 'missing_registered' && (
                      <span className="location-status-text text-alert">
                        No registered address found. Please update your address in Profile or select Current Location.
                      </span>
                    )}
                    {locStatus === 'invalid_registered' && (
                      <span className="location-status-text text-alert">
                        Could not find coordinates for your registered address. Please update your address in Profile.
                      </span>
                    )}
                  </div>
                </div>

                {['denied', 'unavailable'].includes(locStatus) && (
                  <button
                    type="button"
                    className="location-retry-btn"
                    onClick={selectCurrentLocation}
                  >
                    Retry
                  </button>
                )}
                {['missing_registered', 'invalid_registered'].includes(locStatus) && (
                  <button
                    type="button"
                    className="location-retry-btn"
                    onClick={() => {
                      setTab('profile');
                      loadProfile();
                    }}
                  >
                    Edit Profile
                  </button>
                )}
              </div>
            </div>
            {msg && <p className="note">{msg}</p>}
            <div className="result-title">{results.length ? `${results.length} pharmacies with stock` : 'Search results'}</div>
            {searching && (
              <div className="loading-state-box">
                <span className="loading-spinner" aria-hidden="true" />
                <span>Searching nearby pharmacies...</span>
              </div>
            )}
            {!searching && hasSearched && results.length === 0 && !msg && (
              <div className="empty empty-state-box">
                <div className="empty-state-icon" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <h3 className="empty-state-title">No medicines found</h3>
                <p className="empty-state-desc">
                  This medicine is currently unavailable at nearby registered pharmacies. Try searching by generic name or check back later.
                </p>
              </div>
            )}
            {!searching && results.map(r => (
              <article className="result-card" key={r.stock._id}>
                <div className="result-card-header">
                  <div className="result-title-group">
                    <h3 className="medicine-title">{r.stock.medicine}</h3>
                    <p className="medicine-generic">
                      <span className="generic-tag">Generic</span>
                      <span className="generic-name">{r.stock.generic || 'Generic name not provided'}</span>
                    </p>
                  </div>
                  <span className={`stock-badge ${r.stock.quantity === 0 ? 'out-of-stock' : 'in-stock'}`}>
                    <span className="stock-badge-dot" aria-hidden="true" />
                    {r.stock.quantity === 0
                      ? 'Out of stock'
                      : `${r.stock.quantity} available`}
                  </span>
                </div>

                <div className="result-pricing-strip">
                  <div className="price-item">
                    <span className="price-label">Price per tablet</span>
                    <span className="price-value">
                      ₹{r.stock.price ?? '—'}
                      <span className="price-unit">/tablet</span>
                    </span>
                  </div>
                  <div className="stock-status-info">
                    <span className="stock-sublabel">Stock Status</span>
                    <span className={`stock-subval ${r.stock.quantity === 0 ? 'text-out' : 'text-available'}`}>
                      {r.stock.quantity === 0 ? 'Unavailable' : `${r.stock.quantity} in stock`}
                    </span>
                  </div>
                </div>

                <div className="pharmacy-details-card">
                  <div className="pharmacy-top-row">
                    <div className="pharmacy-heading">
                      <span className="pharmacy-icon" aria-hidden="true">🏥</span>
                      <h4 className="pharmacy-name">{r.pharmacy.name}</h4>
                    </div>
                    <span className="distance-pill">
                      📍 {r.distanceKm} km away
                    </span>
                  </div>
                  <p className="pharmacy-address">
                    {r.pharmacy.address}
                  </p>
                </div>

                <div className="card-actions">
                  <a
                    href={dir(r.pharmacy)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-directions"
                  >
                    <svg className="action-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="3 11 22 2 13 21 11 13 3 11" />
                    </svg>
                    View directions
                  </a>
                  <button
                    className={`btn-reserve ${active === r.stock._id ? 'is-active' : ''}`}
                    disabled={r.stock.quantity === 0}
                    onClick={() => {
                      setActive(active === r.stock._id ? null : r.stock._id);
                      setQuantity(1);
                    }}
                  >
                    {r.stock.quantity === 0 ? 'Out of stock' : active === r.stock._id ? 'Close' : 'Reserve'}
                  </button>
                </div>

                {active === r.stock._id && (
                  <div className="reserve-row">
                    <div className="reserve-panel-header">
                      <h5 className="reserve-panel-title">Reserve for in-store pickup</h5>
                      <span className="reserve-panel-hint">Hold for 2 hours</span>
                    </div>

                    <div className="reserve-form-body">
                      <label className="reserve-qty-label">
                        <span>Quantity (tablets)</span>
                        <input
                          type="number"
                          min="1"
                          value={quantity}
                          onChange={e => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                        />
                      </label>

                      <div className="reservation-total">
                        <p className="res-calc-line">
                          <span>Price per tablet:</span>
                          <strong>₹{r.stock.price ?? '—'}</strong>
                        </p>
                        <p className="res-calc-line total-highlight">
                          <span>Total:</span>
                          <strong>
                            ₹
                            {r.stock.price != null
                              ? (Number(r.stock.price) * quantity).toFixed(2)
                              : '—'}
                          </strong>
                        </p>
                      </div>
                    </div>

                    {quantity !== '' && quantity > r.stock.quantity && (
                      <p className="stock-error">
                        ❌ Only {r.stock.quantity} tablets available
                      </p>
                    )}

                    <button
                      className="confirm-reserve-btn"
                      onClick={() => reserve(r)}
                      disabled={
                        quantity === '' ||
                        quantity < 1 ||
                        quantity > r.stock.quantity
                      }
                    >
                      Confirm reservation
                    </button>
                  </div>
                )}
              </article>
            ))}
          </section>
          <section className="map-panel">
            {pos ? (
              <iframe
                title="Google Maps Location View"
                className="interactive-map-frame"
                src={`https://maps.google.com/maps?q=${pos.lat},${pos.lng}&z=13&output=embed`}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
              />
            ) : (
              <div className="map-placeholder">
                Select your Current or Registered Location to view nearby pharmacies on the map.
              </div>
            )}
          </section>
              </main>
      ) : tab === 'reservations' ? (
        <main className="content-wrap">
          <section className="panel">
            <h2>My reservations</h2>

            {loadingReservations && (
              <div className="loading-state-box">
                <span className="loading-spinner" aria-hidden="true" />
                <span>Loading your reservations...</span>
              </div>
            )}

            {!loadingReservations && reservations.length === 0 && (
              <div className="empty empty-state-box">
                <div className="empty-state-icon" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <h3 className="empty-state-title">No active reservations</h3>
                <p className="empty-state-desc">
                  You haven't reserved any medicines yet. Search for a medicine above to place a hold at a nearby pharmacy.
                </p>
              </div>
            )}

            {!loadingReservations && reservations.map(r => (
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

          {!editingAddress ? (
            <div className="profile-edit-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <strong>Address & Location</strong>
                <button
                  type="button"
                  className="edit-address-button"
                  onClick={handleStartEditAddress}
                >
                  Edit Address
                </button>
              </div>

              <div className="address-display-box" style={{ marginBottom: '14px' }}>
                <p className="address-text">
                  {profile.address || 'No registered address set.'}
                </p>
              </div>

              <PharmacyLocationPicker
                position={parseCoordinates(profile.location)}
                readOnly={true}
              />
            </div>
          ) : (
            <div className="profile-edit-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <strong>Edit Address & Location</strong>
              </div>

              <div className="address-input-row">
                <input
                  type="text"
                  value={typedAddress}
                  onChange={handleAddressInputChange}
                  placeholder="Enter your address"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="find-on-map-button"
                  disabled={resolvingAddress || !typedAddress.trim()}
                  onClick={handleFindOnMap}
                  title="Search address on map"
                >
                  {resolvingAddress ? 'Searching…' : '🔍 Find on Map'}
                </button>
              </div>

              {addressNeedsResolution && (
                <small className="hint" style={{ display: 'block', marginTop: '6px', color: '#b54708', fontWeight: '500' }}>
                  ⚠️ Address modified. Click &ldquo;Find on Map&rdquo; to locate it or select your location on the map before saving.
                </small>
              )}

              {resolvingAddress && (
                <small className="hint" style={{ display: 'block', marginTop: '6px' }}>
                  🔍 Looking up coordinates for the entered address…
                </small>
              )}

              {geocodeMsg && (
                <p className="note" style={{ marginTop: '8px', marginBottom: '8px' }}>
                  {geocodeMsg}
                </p>
              )}

              {addressSuggestions.length > 1 && (
                <div className="address-suggestions-container" style={{ marginTop: '8px', marginBottom: '12px' }}>
                  <span className="suggestions-title" style={{ fontSize: '0.82rem', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                    Did you mean:
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {addressSuggestions.slice(0, 3).map((item, idx) => (
                      <button
                        key={item.id || idx}
                        type="button"
                        className="suggestion-item-btn"
                        style={{
                          textAlign: 'left',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: '1px solid var(--line)',
                          background: '#fff',
                          cursor: 'pointer',
                          fontSize: '0.85rem'
                        }}
                        onClick={() => handleSelectSuggestion(item)}
                      >
                        📍 {item.displayName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: '12px', marginBottom: '12px' }}>
                <PharmacyLocationPicker
                  position={selectedLocation}
                  onChange={handleLocationChange}
                />
              </div>

              <div className="address-actions">
                <button
                  type="button"
                  className="save-profile-button"
                  disabled={savingAddress || resolvingAddress}
                  onClick={handleSaveAddress}
                >
                  {savingAddress ? 'Saving address…' : 'Save Address'}
                </button>
                <button
                  type="button"
                  className="cancel-address-button"
                  disabled={savingAddress || resolvingAddress}
                  onClick={handleCancelEdit}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

  {profileMsg.text && (
    <div
      className={profileMsg.type === 'error' ? 'error-box' : 'hint'}
      style={{
        marginTop: '12px',
        color: profileMsg.type === 'success' ? 'var(--pine)' : undefined,
        fontWeight: profileMsg.type === 'success' ? '600' : undefined
      }}
    >
      {profileMsg.type === 'success' ? '✓ ' : ''}{profileMsg.text}
    </div>
  )}

  <p>
    <strong>Account created:</strong>{' '}
    {new Date(profile.createdAt).toLocaleDateString()}
  </p>
</div>
      )}

      <h2>Reservation history</h2>

      {loadingReservations ? (
        <div className="loading-state-box">
          <span className="loading-spinner" aria-hidden="true" />
          <span>Loading reservation history...</span>
        </div>
      ) : reservations.length === 0 ? (
        <div className="empty empty-state-box">
          <div className="empty-state-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 14 14" />
            </svg>
          </div>
          <h3 className="empty-state-title">No reservation history</h3>
          <p className="empty-state-desc">
            Your past completed or cancelled reservations will appear here.
          </p>
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
