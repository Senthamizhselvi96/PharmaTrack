import { useState, useEffect, useRef } from 'react';
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from '@react-google-maps/api';
import { MapContainer, TileLayer, Marker as LeafletMarker, Popup as LeafletPopup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isGoogleMapsConfigured } from './PatientGoogleLocationPicker.jsx';

const GOOGLE_MAPS_LIBRARIES = ['places'];
const DEFAULT_CENTER = { lat: 13.0827, lng: 80.2707 }; // Chennai coordinates

function isValidCoord(pos) {
  if (!pos) return false;
  const lat = Number(pos.lat);
  const lng = Number(pos.lng);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// Leaflet custom vector icons (clean, high-DPI, no missing asset bugs)
const leafletUserIcon = L.divIcon({
  className: 'patient-map-pin-user',
  html: `<div style="
    background: #0d9488;
    color: #ffffff;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(13, 148, 136, 0.45);
    border: 3px solid #ffffff;
    font-size: 17px;
  ">📍</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -20]
});

const leafletPharmacyIcon = L.divIcon({
  className: 'patient-map-pin-pharmacy',
  html: `<div style="
    background: #e11d48;
    color: #ffffff;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(225, 29, 72, 0.4);
    border: 2.5px solid #ffffff;
    font-size: 15px;
  ">🏥</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -18]
});

// Leaflet helper to smoothly update view when center or bounds change
function LeafletMapController({ center, pharmacies }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    if (!center) return;

    if (pharmacies && pharmacies.length > 0) {
      // Fit bounds to include user and nearby pharmacies
      const bounds = L.latLngBounds([[center.lat, center.lng]]);
      pharmacies.forEach(r => {
        const coords = r.pharmacy?.location?.coordinates;
        if (coords && coords.length === 2) {
          bounds.extend([coords[1], coords[0]]);
        }
      });
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    } else {
      map.setView([center.lat, center.lng], 14);
    }
  }, [map, center?.lat, center?.lng, pharmacies]);

  return null;
}

/**
 * Leaflet Fallback Map component
 */
function PatientLeafletMap({
  center,
  pharmacies,
  activePos,
  fallbackNotice
}) {
  return (
    <div className="patient-map-wrapper" style={{ position: 'relative', width: '100%', height: '100%' }}>
      {fallbackNotice && (
        <div className="map-fallback-banner" role="status">
          <span className="map-banner-icon">ℹ️</span>
          <span className="map-banner-text">{fallbackNotice}</span>
        </div>
      )}

      <MapContainer
        center={[center.lat, center.lng]}
        zoom={14}
        style={{ width: '100%', height: '100%', minHeight: '600px', borderRadius: '16px' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <LeafletMapController center={center} pharmacies={pharmacies} />

        {/* Selected User Location Marker */}
        {activePos && (
          <LeafletMarker position={[activePos.lat, activePos.lng]} icon={leafletUserIcon}>
            <LeafletPopup>
              <div className="map-popup-card">
                <div className="map-popup-badge-user">Your Location</div>
                <strong style={{ display: 'block', margin: '4px 0 2px', fontSize: '0.95rem' }}>
                  Selected Search Center
                </strong>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  {Number(activePos.lat).toFixed(4)}, {Number(activePos.lng).toFixed(4)}
                </span>
              </div>
            </LeafletPopup>
          </LeafletMarker>
        )}

        {/* Nearby Pharmacy Markers */}
        {pharmacies.map(r => {
          const coords = r.pharmacy?.location?.coordinates;
          if (!coords || coords.length !== 2) return null;
          const lat = coords[1];
          const lng = coords[0];
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

          return (
            <LeafletMarker
              key={r.stock?._id || `${r.pharmacy?._id}-${lat}-${lng}`}
              position={[lat, lng]}
              icon={leafletPharmacyIcon}
            >
              <LeafletPopup>
                <div className="map-popup-card">
                  <div className="map-popup-badge-pharmacy">Pharmacy</div>
                  <strong style={{ display: 'block', fontSize: '1rem', color: '#0f172a', margin: '4px 0' }}>
                    {r.pharmacy?.name}
                  </strong>
                  <p style={{ margin: '0 0 6px', fontSize: '0.84rem', color: '#64748b', lineHeight: 1.35 }}>
                    {r.pharmacy?.address}
                  </p>
                  <div style={{ background: '#f1f5f9', padding: '6px 8px', borderRadius: '6px', fontSize: '0.82rem' }}>
                    <div><strong>Medicine:</strong> {r.stock?.medicine}</div>
                    <div><strong>Available:</strong> {r.stock?.quantity} units</div>
                    <div><strong>Price:</strong> ₹{r.stock?.price}</div>
                  </div>
                  {activePos && (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&origin=${activePos.lat},${activePos.lng}&destination=${lat},${lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="map-popup-directions-btn"
                    >
                      Get Directions ↗
                    </a>
                  )}
                </div>
              </LeafletPopup>
            </LeafletMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

/**
 * Google Maps Implementation Component
 */
function PatientGoogleMapInstance({
  center,
  pharmacies,
  activePos
}) {
  const mapRef = useRef(null);
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [showUserTooltip, setShowUserTooltip] = useState(false);

  // Fit bounds when results or position change
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;

    if (pharmacies && pharmacies.length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      if (activePos) {
        bounds.extend({ lat: Number(activePos.lat), lng: Number(activePos.lng) });
      }
      pharmacies.forEach(r => {
        const coords = r.pharmacy?.location?.coordinates;
        if (coords && coords.length === 2) {
          bounds.extend({ lat: Number(coords[1]), lng: Number(coords[0]) });
        }
      });
      mapRef.current.fitBounds(bounds, { top: 60, bottom: 60, left: 60, right: 60 });
    } else if (activePos) {
      mapRef.current.panTo({ lat: Number(activePos.lat), lng: Number(activePos.lng) });
      mapRef.current.setZoom(14);
    }
  }, [pharmacies, activePos]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <GoogleMap
        mapContainerStyle={{
          width: '100%',
          height: '100%',
          minHeight: '600px',
          borderRadius: '16px'
        }}
        center={center}
        zoom={14}
        onLoad={map => {
          mapRef.current = map;
        }}
        options={{
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
          gestureHandling: 'auto'
        }}
      >
        {/* User Selected Location Marker */}
        {activePos && (
          <Marker
            position={{ lat: Number(activePos.lat), lng: Number(activePos.lng) }}
            title="Your Selected Location"
            onClick={() => setShowUserTooltip(true)}
            icon={{
              path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
              scale: 9,
              fillColor: '#0d9488',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 3
            }}
          />
        )}

        {showUserTooltip && activePos && (
          <InfoWindow
            position={{ lat: Number(activePos.lat), lng: Number(activePos.lng) }}
            onCloseClick={() => setShowUserTooltip(false)}
          >
            <div className="map-popup-card">
              <div className="map-popup-badge-user">Your Location</div>
              <strong style={{ display: 'block', margin: '4px 0 2px', fontSize: '0.92rem' }}>
                Selected Search Center
              </strong>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                {Number(activePos.lat).toFixed(4)}, {Number(activePos.lng).toFixed(4)}
              </span>
            </div>
          </InfoWindow>
        )}

        {/* Nearby Pharmacy Markers */}
        {pharmacies.map(r => {
          const coords = r.pharmacy?.location?.coordinates;
          if (!coords || coords.length !== 2) return null;
          const lat = Number(coords[1]);
          const lng = Number(coords[0]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

          return (
            <Marker
              key={r.stock?._id || `${r.pharmacy?._id}-${lat}-${lng}`}
              position={{ lat, lng }}
              title={`${r.pharmacy?.name} - ${r.stock?.medicine}`}
              onClick={() => setSelectedPharmacy(r)}
            />
          );
        })}

        {/* Selected Pharmacy Info Window */}
        {selectedPharmacy && (
          <InfoWindow
            position={{
              lat: Number(selectedPharmacy.pharmacy?.location?.coordinates[1]),
              lng: Number(selectedPharmacy.pharmacy?.location?.coordinates[0])
            }}
            onCloseClick={() => setSelectedPharmacy(null)}
          >
            <div className="map-popup-card">
              <div className="map-popup-badge-pharmacy">Pharmacy</div>
              <strong style={{ display: 'block', fontSize: '1rem', color: '#0f172a', margin: '4px 0' }}>
                {selectedPharmacy.pharmacy?.name}
              </strong>
              <p style={{ margin: '0 0 6px', fontSize: '0.84rem', color: '#64748b', lineHeight: 1.35 }}>
                {selectedPharmacy.pharmacy?.address}
              </p>
              <div style={{ background: '#f1f5f9', padding: '6px 8px', borderRadius: '6px', fontSize: '0.82rem' }}>
                <div><strong>Medicine:</strong> {selectedPharmacy.stock?.medicine}</div>
                <div><strong>Available:</strong> {selectedPharmacy.stock?.quantity} units</div>
                <div><strong>Price:</strong> ₹{selectedPharmacy.stock?.price}</div>
              </div>
              {activePos && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&origin=${activePos.lat},${activePos.lng}&destination=${selectedPharmacy.pharmacy?.location?.coordinates[1]},${selectedPharmacy.pharmacy?.location?.coordinates[0]}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="map-popup-directions-btn"
                >
                  Get Directions ↗
                </a>
              )}
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </div>
  );
}

/**
 * Main PatientDashboardMap Component
 *
 * Responsibilities:
 * 1. Always renders on the RIGHT side of the patient dashboard (65% width).
 * 2. Stays visible immediately upon dashboard load, centered on user location (or default Chennai).
 * 3. Shows marker for user's selected location.
 * 4. Shows markers for all nearby pharmacies when search results are available.
 * 5. Remains visible even when search results are empty.
 * 6. Uses Google Maps when API key is configured; if Google Maps fails to load or key is missing,
 *    displays a meaningful notice/error and seamlessly presents interactive Leaflet map.
 */
export default function PatientDashboardMap({
  userLocation,
  results = []
}) {
  const isConfigured = isGoogleMapsConfigured();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'pharmatrack-google-maps-script',
    googleMapsApiKey: isConfigured ? apiKey : '',
    libraries: GOOGLE_MAPS_LIBRARIES
  });

  const activePos = isValidCoord(userLocation) ? userLocation : null;
  const center = activePos
    ? { lat: Number(activePos.lat), lng: Number(activePos.lng) }
    : DEFAULT_CENTER;

  // 1. If Google Maps fails to load:
  if (loadError) {
    return (
      <div className="patient-gmap-container">
        <PatientLeafletMap
          center={center}
          pharmacies={results}
          activePos={activePos}
          fallbackNotice="Google Maps failed to load. Displaying interactive OpenStreetMap view."
        />
      </div>
    );
  }

  // 2. If Google Maps is not configured with an API key:
  if (!isConfigured) {
    return (
      <div className="patient-gmap-container">
        <PatientLeafletMap
          center={center}
          pharmacies={results}
          activePos={activePos}
        />
      </div>
    );
  }

  // 3. Google Maps is configured and loading:
  if (!isLoaded) {
    return (
      <div className="patient-gmap-container map-loading-container">
        <div className="map-loading-state">
          <span className="loading-spinner" aria-hidden="true" />
          <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--pine)' }}>
            Loading Google Map...
          </span>
        </div>
      </div>
    );
  }

  // 4. Google Maps is configured and loaded successfully:
  return (
    <div className="patient-gmap-container">
      <PatientGoogleMapInstance
        center={center}
        pharmacies={results}
        activePos={activePos}
      />
    </div>
  );
}
