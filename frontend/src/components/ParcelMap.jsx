import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap, ScaleControl } from 'react-leaflet';
import L from 'leaflet';

const BASEMAPS = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    nativeZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri and imagery contributors',
    nativeZoom: 19,
  },
};

function ZoomToParcel({ data }) {
  const map = useMap();
  useEffect(() => {
    if (!data?.features?.length) return;
    const bounds = L.geoJSON(data).getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 20 });
    }
  }, [data, map]);
  return null;
}

export default function ParcelMap({ data }) {
  const [basemap, setBasemap] = useState('light');
  const selected = BASEMAPS[basemap];

  return (
    <div className="parcel-map-wrapper">
      <div className="basemap-switcher" role="group" aria-label="Basemap style">
        <button
          type="button"
          className={basemap === 'light' ? 'active' : ''}
          aria-pressed={basemap === 'light'}
          onClick={() => setBasemap('light')}
        >
          Simple map
        </button>
        <button
          type="button"
          className={basemap === 'satellite' ? 'active' : ''}
          aria-pressed={basemap === 'satellite'}
          onClick={() => setBasemap('satellite')}
        >
          Satellite
        </button>
      </div>
      <MapContainer
        center={[-0.1807, -78.4678]}
        zoom={11}
        minZoom={2}
        maxZoom={22}
        zoomSnap={0.5}
        zoomDelta={0.5}
        className="map"
        scrollWheelZoom={true}
        zoomControl={true}
      >
        <TileLayer
          key={basemap}
          url={selected.url}
          attribution={selected.attribution}
          maxNativeZoom={selected.nativeZoom}
          maxZoom={22}
          subdomains={basemap === 'light' ? 'abcd' : 'abc'}
        />
        {data && (
          <GeoJSON
            key={JSON.stringify(data.features.map(f => f.properties?.fid))}
            data={data}
            style={{
              color: '#00a99a',
              weight: 3,
              fillColor: '#00bbaa',
              fillOpacity: basemap === 'satellite' ? 0.12 : 0.20,
            }}
          />
        )}
        <ZoomToParcel data={data} />
        <ScaleControl position="bottomleft" metric={true} imperial={false} />
      </MapContainer>
    </div>
  );
}
