import { useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';

function ZoomToParcel({ data }) {
  const map = useMap();
  useEffect(() => {
    if (!data?.features?.length) return;
    const layer = L.geoJSON(data);
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 18 });
  }, [data, map]);
  return null;
}
export default function ParcelMap({ data }) {
  return <MapContainer center={[-0.1807, -78.4678]} zoom={11} className="map" scrollWheelZoom={true}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    {data && <GeoJSON key={JSON.stringify(data.features.map(f => f.properties?.fid))} data={data} style={{ color: '#17b6aa', weight: 3, fillColor: '#17b6aa', fillOpacity: 0.22 }} />}
    <ZoomToParcel data={data}/>
  </MapContainer>;
}
