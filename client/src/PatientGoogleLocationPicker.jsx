import { useEffect, useRef } from 'react';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import PharmacyLocationPicker from './PharmacyLocationPicker.jsx';

const GOOGLE_MAPS_LIBRARIES = ['places'];

function isValidCoordinate(pos) {
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

/**
 * Checks whether a valid (non-placeholder) Google Maps API key is available.
 */
export function isGoogleMapsConfigured() {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return Boolean(
    key &&
    key.trim() &&
    key !== 'your-google-maps-api-key' &&
    !key.includes('your-google-maps')
  );
}

/**
 * Google Places Autocomplete Input Component
 * Attaches Google Places Autocomplete when Google Maps JS is loaded,
 * while seamlessly supporting manual address input and Enter-to-search.
 */
export function GooglePlacesAddressInput({
  value,
  onChange,
  onPlaceSelected,
  onSearch,
  disabled,
  placeholder = 'Enter your address (e.g., Mullai Nagar, Ramapuram, Chennai)'
}) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const isConfigured = isGoogleMapsConfigured();

  useEffect(() => {
    if (!isConfigured || typeof window === 'undefined' || !window.google?.maps?.places || !inputRef.current) {
      return;
    }

    try {
      const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
        fields: ['formatted_address', 'geometry', 'name', 'address_components']
      });

      const listener = autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (place && onPlaceSelected) {
          onPlaceSelected(place);
        }
      });

      autocompleteRef.current = autocomplete;

      return () => {
        if (window.google?.maps?.event && listener) {
          window.google.maps.event.removeListener(listener);
        }
      };
    } catch (err) {
      console.warn('Could not initialize Google Places Autocomplete:', err);
    }
  }, [isConfigured, onPlaceSelected]);

  return (
    <div className="address-input-row">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        className="registered-address-input"
        style={{ flex: 1 }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (onSearch) onSearch();
          }
        }}
      />
      <button
        type="button"
        className="find-on-map-button"
        disabled={disabled || !String(value || '').trim()}
        onClick={onSearch}
        title="Search address on map"
      >
        {disabled ? 'Searching…' : '🔍 Find on Map'}
      </button>
    </div>
  );
}

/**
 * Internal Google Maps implementation
 */
function GoogleMapsLocationView({
  position,
  onChange,
  readOnly = false,
  zoom = 16
}) {
  const mapRef = useRef(null);
  const defaultCenter = { lat: 13.0827, lng: 80.2707 }; // Chennai center

  const hasValidPosition = isValidCoordinate(position);
  const center = hasValidPosition
    ? { lat: Number(position.lat), lng: Number(position.lng) }
    : defaultCenter;

  // Pan smoothly to updated position
  useEffect(() => {
    if (mapRef.current && hasValidPosition) {
      mapRef.current.panTo({
        lat: Number(position.lat),
        lng: Number(position.lng)
      });
    }
  }, [position?.lat, position?.lng, hasValidPosition]);

  const handleMapClick = (e) => {
    if (readOnly || !onChange || !e?.latLng) return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      onChange({ lat, lng });
    }
  };

  const handleMarkerDragEnd = (e) => {
    if (readOnly || !onChange || !e?.latLng) return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      onChange({ lat, lng });
    }
  };

  return (
    <div className="google-map-picker-root">
      <GoogleMap
        mapContainerClassName="google-map-container"
        mapContainerStyle={{
          width: '100%',
          height: '350px',
          borderRadius: '12px'
        }}
        center={center}
        zoom={hasValidPosition ? zoom : 11}
        onClick={handleMapClick}
        onLoad={(map) => {
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
        {hasValidPosition && (
          <Marker
            position={{
              lat: Number(position.lat),
              lng: Number(position.lng)
            }}
            draggable={!readOnly}
            onDragEnd={handleMarkerDragEnd}
            animation={window.google?.maps?.Animation ? window.google.maps.Animation.DROP : undefined}
          />
        )}
      </GoogleMap>

      {readOnly ? (
        hasValidPosition ? (
          <p className="muted" style={{ marginTop: '8px', fontSize: '0.9rem', textAlign: 'center' }}>
            📍 Saved coordinates: {Number(position.lat).toFixed(6)}, {Number(position.lng).toFixed(6)}
          </p>
        ) : (
          <p className="muted" style={{ marginTop: '8px', fontSize: '0.9rem', textAlign: 'center' }}>
            No coordinates currently set for this address. Click &ldquo;Edit Address&rdquo; to set location.
          </p>
        )
      ) : hasValidPosition ? (
        <p className="muted" style={{ marginTop: '8px', fontSize: '0.9rem', textAlign: 'center' }}>
          📍 Selected coordinates: {Number(position.lat).toFixed(6)}, {Number(position.lng).toFixed(6)}
          <span style={{ display: 'block', fontSize: '0.82rem', color: 'var(--muted)', marginTop: '2px' }}>
            (Drag the marker or click on the map to fine-tune your exact building)
          </span>
        </p>
      ) : (
        <p className="muted" style={{ marginTop: '8px', fontSize: '0.9rem', textAlign: 'center' }}>
          Click on the map or search address above to place the pin.
        </p>
      )}
    </div>
  );
}

/**
 * Main PatientGoogleLocationPicker component.
 * Uses Google Maps JavaScript API when a valid API key is present,
 * and gracefully falls back to Leaflet / OpenStreetMap if the key is missing,
 * invalid, or fails to load.
 */
export default function PatientGoogleLocationPicker({
  position,
  onChange,
  readOnly = false,
  zoom = 16
}) {
  const isConfigured = isGoogleMapsConfigured();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  // Only load the Google Maps script when a non-placeholder key is provided
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'pharmatrack-google-maps-script',
    googleMapsApiKey: isConfigured ? apiKey : '',
    libraries: GOOGLE_MAPS_LIBRARIES
  });

  // If not configured or failed to load, fall back to Leaflet with graceful fallback message
  if (!isConfigured || loadError) {
    return (
      <div className="google-maps-fallback-wrapper">
        <PharmacyLocationPicker
          position={position}
          onChange={onChange}
          readOnly={readOnly}
        />
      </div>
    );
  }

  // Loading state
  if (!isLoaded) {
    return (
      <div
        className="google-map-container"
        style={{
          width: '100%',
          height: '350px',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f6f8f7',
          color: 'var(--muted)',
          fontSize: '0.95rem',
          border: '1px solid var(--line)'
        }}
      >
        <span>Loading map…</span>
      </div>
    );
  }

  return (
    <GoogleMapsLocationView
      position={position}
      onChange={onChange}
      readOnly={readOnly}
      zoom={zoom}
    />
  );
}
