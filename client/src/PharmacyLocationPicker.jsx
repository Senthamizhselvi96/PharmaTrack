import { useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  useMap,
  useMapEvents
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const pharmacyIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34]
});

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

function MapClickHandler({ onChange }) {
  useMapEvents({
    click(e) {
      if (e?.latlng && Number.isFinite(e.latlng.lat) && Number.isFinite(e.latlng.lng)) {
        onChange({
          lat: Number(e.latlng.lat),
          lng: Number(e.latlng.lng)
        });
      }
    }
  });

  return null;
}

function MapPositionUpdater({ position }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    if (isValidCoordinate(position)) {
      const lat = Number(position.lat);
      const lng = Number(position.lng);
      map.setView([lat, lng], map.getZoom() || 16);
    }
  }, [map, position?.lat, position?.lng]);

  return null;
}

export default function PharmacyLocationPicker({
  position,
  onChange,
  readOnly = false
}) {
  const defaultCenter = [13.0827, 80.2707];

  const hasValidPosition = isValidCoordinate(position);
  const center = hasValidPosition
    ? [Number(position.lat), Number(position.lng)]
    : defaultCenter;

  return (
    <div>
      <MapContainer
        center={center}
        zoom={hasValidPosition ? 16 : 11}
        style={{
          height: '350px',
          width: '100%',
          borderRadius: '12px'
        }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {!readOnly && onChange && <MapClickHandler onChange={onChange} />}

        <MapPositionUpdater position={position} />

        {hasValidPosition && (
          <Marker
            position={[Number(position.lat), Number(position.lng)]}
            icon={pharmacyIcon}
            draggable={!readOnly}
            eventHandlers={
              !readOnly && onChange
                ? {
                    dragend(e) {
                      const point = e.target.getLatLng();
                      if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
                        onChange({
                          lat: Number(point.lat),
                          lng: Number(point.lng)
                        });
                      }
                    }
                  }
                : {}
            }
          />
        )}
      </MapContainer>

      {readOnly ? (
        hasValidPosition ? (
          <p className="muted" style={{ marginTop: '8px', fontSize: '0.9rem' }}>
            📍 Saved coordinates: {Number(position.lat).toFixed(6)}, {Number(position.lng).toFixed(6)}
          </p>
        ) : (
          <p className="muted" style={{ marginTop: '8px', fontSize: '0.9rem' }}>
            No coordinates currently set for this address. Click &ldquo;Edit Address&rdquo; to set location.
          </p>
        )
      ) : hasValidPosition ? (
        <p className="muted" style={{ marginTop: '8px', fontSize: '0.9rem' }}>
          Selected coordinates: {Number(position.lat).toFixed(6)}, {Number(position.lng).toFixed(6)}
        </p>
      ) : (
        <p className="muted" style={{ marginTop: '8px', fontSize: '0.9rem' }}>
          Click on the map or drag the marker to choose exact coordinates.
        </p>
      )}
    </div>
  );
}

