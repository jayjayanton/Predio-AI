
import React, { useEffect, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  ScaleControl,
  useMap
} from 'react-leaflet';
import L from 'leaflet';

// ArcGIS public basemap endpoints.
// No API key required for these legacy public services.
// Check Esri's terms before production deployment.


const BASEMAPS = {
  light: {
    name: 'Light Gray',
    url:
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri and contributors',
    nativeZoom: 16
  },

  topographic: {
    name: 'Topographic',
    url:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri and contributors',
    nativeZoom: 19
  },

  satellite: {
    name: 'Satellite',
    url:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri and imagery contributors',
    nativeZoom: 19
  }
};


// Automatically zoom to a selected cadastral parcel.

function ZoomToParcel({ data }) {
  const map = useMap();

  useEffect(() => {
    if (!data?.features?.length) return;

    const parcelLayer = L.geoJSON(data);
    const bounds = parcelLayer.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [48, 48],
        maxZoom: 20
      });
    }
  }, [data, map]);

  return null;
}

// Main cadastral map component.

export default function ParcelMap({ data }) {
  const [basemap, setBasemap] = useState('light');

  const selectedBasemap = BASEMAPS[basemap];

  return (
    <div className="parcel-map-wrapper">

      {/* Basemap selector */}

      <div
        className="basemap-switcher"
        role="group"
        aria-label="Basemap selector"
      >
        <button
          type="button"
          className={basemap === 'light' ? 'active' : ''}
          aria-pressed={basemap === 'light'}
          onClick={() => setBasemap('light')}
        >
          Light Gray
        </button>

        <button
          type="button"
          className={basemap === 'topographic' ? 'active' : ''}
          aria-pressed={basemap === 'topographic'}
          onClick={() => setBasemap('topographic')}
        >
          Topographic
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

      {/* Leaflet map */}

      <MapContainer
        center={[-0.1807, -78.4678]}
        zoom={11}
        minZoom={2}
        maxZoom={22}
        zoomSnap={0.5}
        zoomDelta={0.5}
        scrollWheelZoom={true}
        zoomControl={true}
        className="map"
      >

        {/* ArcGIS basemap */}

        <TileLayer
          key={basemap}
          url={selectedBasemap.url}
          attribution={selectedBasemap.attribution}
          maxNativeZoom={selectedBasemap.nativeZoom}
          maxZoom={22}
        />

        {/* Municipal cadastral polygons */}

        {data && (
          <GeoJSON
            key={JSON.stringify(
              data.features.map(
                feature => feature.properties?.fid
              )
            )}
            data={data}
            style={{
              color: '#00bfae',
              weight: 3,
              fillColor: '#00bfae',
              fillOpacity:
                basemap === 'satellite' ? 0.12 : 0.20
            }}
          />
        )}

        {/* Automatically focus on property */}

        <ZoomToParcel data={data} />

        {/* Metric scale bar */}

        <ScaleControl
          position="bottomleft"
          metric={true}
          imperial={false}
        />

      </MapContainer>
    </div>
  );
}
