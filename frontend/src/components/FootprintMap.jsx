import React, {useEffect, useMemo, useRef, useState} from 'react';
import {GeoJSON, MapContainer, Marker, Polyline, ScaleControl, TileLayer, Tooltip, useMap, useMapEvents} from 'react-leaflet';
import L from 'leaflet';
import {parcelBounds, parcelEdges} from '../footprintPlanning.js';
import {parseCoordinateInput} from '../locationAnalysis.js';

const ANCHOR_ICON = L.divIcon({className: 'footprint-map-anchor', html: '<span aria-hidden="true">✣</span>', iconSize: [32, 32], iconAnchor: [16, 16]});
const ROLE_STYLE = {
  existing: {color: '#1d6257', weight: 2.5, fillColor: '#3f8c79', fillOpacity: 0.42},
  extension: {color: '#b56a21', weight: 2.5, fillColor: '#e6ab64', fillOpacity: 0.48, dashArray: '6 4'},
  furniture: {color: '#5d6c8a', weight: 1.2, fillColor: '#7c89a2', fillOpacity: 0.18},
};

function MapBehavior({geometry, placement, placeOnClick, onPlacementChange, frame}) {
  const map = useMap();
  const bounds = useMemo(() => parcelBounds(geometry), [geometry]);
  useMapEvents({click(event) {
    if (placeOnClick) onPlacementChange({latitude: String(event.latlng.lat), longitude: String(event.latlng.lng), confirmed: false});
  }});
  useEffect(() => {
    if (bounds) map.fitBounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]], {padding: [35, 35], maxZoom: 20, animate: false});
  }, [map, bounds, frame]);
  useEffect(() => {
    const container = map.getContainer();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => map.invalidateSize({pan: false})) : null;
    observer?.observe(container);
    map.invalidateSize({pan: false});
    return () => observer?.disconnect();
  }, [map]);
  const lat = parseCoordinateInput(placement?.latitude), lon = parseCoordinateInput(placement?.longitude);
  if (lat === null || lon === null || Math.abs(lat) >= 85 || Math.abs(lon) > 180) return null;
  return <Marker position={[lat, lon]} icon={ANCHOR_ICON} draggable title="Mover el origen de la huella" alt="Origen de la huella propuesta"
    eventHandlers={{dragend(event) {
      const position = event.target.getLatLng();
      onPlacementChange({latitude: String(position.lat), longitude: String(position.lng), confirmed: false});
    }}}><Tooltip direction="top" offset={[0, -16]}>Arrastra para ubicar la huella</Tooltip></Marker>;
}

export default function FootprintMap({geometry, placement, placed, onPlacementChange, edgesVisible = false, selectedEdge, onSelectEdge, edgeKinds = {}}) {
  const bounds = useMemo(() => parcelBounds(geometry), [geometry]);
  const edges = useMemo(() => parcelEdges(geometry), [geometry]);
  const [placeOnClick, setPlaceOnClick] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [frame, setFrame] = useState(0);
  const mapId = useRef(`footprint-map-${Math.random().toString(36).slice(2)}`);
  const visible = useMemo(() => ({type: 'FeatureCollection', features: (placed?.features || []).filter(feature => feature.properties?.role !== 'combined')}), [placed]);
  if (!bounds) return null;
  return <div className="footprint-map-shell">
    <div className="footprint-map-tools">
      <div><button type="button" className={placeOnClick ? 'is-active' : ''} aria-pressed={placeOnClick} onClick={() => setPlaceOnClick(value => !value)}>Colocar con un clic</button>
        <button type="button" onClick={() => setFrame(value => value + 1)}>Encuadrar predio</button></div>
      <button type="button" aria-pressed={satellite} className={satellite ? 'is-active' : ''} onClick={() => setSatellite(value => !value)}>{satellite ? 'Ver calles' : 'Ver satélite'}</button>
    </div>
    <div className="footprint-map-frame" id={mapId.current}>
      <MapContainer center={[(bounds[1] + bounds[3]) / 2, (bounds[0] + bounds[2]) / 2]} zoom={18} maxZoom={22} minZoom={3}
        scrollWheelZoom={false} className="footprint-leaflet-map" aria-label="Implantación propuesta de la huella sobre el predio">
        <TileLayer key={satellite ? 'satellite' : 'streets'}
          url={satellite ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'}
          attribution="Tiles &copy; Esri and contributors" maxNativeZoom={19} maxZoom={22}/>
        <GeoJSON key={JSON.stringify(geometry)} data={geometry} style={{color: '#405b80', weight: 3, fillColor: '#e6edf7', fillOpacity: satellite ? 0.1 : 0.28}} interactive={false}/>
        {visible.features.length > 0 && <GeoJSON key={JSON.stringify(visible)} data={visible} style={feature => ROLE_STYLE[feature.properties?.role] || ROLE_STYLE.extension} interactive={false}/>}
        {edgesVisible && edges.map(edge => <Polyline key={edge.id} positions={edge.positions} bubblingMouseEvents={false}
          pathOptions={{color: selectedEdge === edge.id ? '#b56a21' : edgeKinds[edge.id] ? '#405b80' : '#99a5b4', weight: selectedEdge === edge.id ? 8 : 5, opacity: 0.9}}
          eventHandlers={{click(event) {L.DomEvent.stopPropagation(event.originalEvent); onSelectEdge?.(edge.id);}}}>
          <Tooltip sticky>{edge.label} · {{front: 'frontal', side: 'lateral', rear: 'posterior'}[edgeKinds[edge.id]] || 'sin asignar'}</Tooltip>
        </Polyline>)}
        <MapBehavior geometry={geometry} placement={placement} placeOnClick={placeOnClick} onPlacementChange={onPlacementChange} frame={frame}/>
        <ScaleControl position="bottomleft" metric imperial={false}/>
      </MapContainer>
      <span className="footprint-north" aria-label="Norte geográfico">N ↑</span>
    </div>
    <div className="footprint-legend" aria-label="Leyenda de implantación"><span><i className="is-parcel"/>Predio</span><span><i className="is-existing"/>Huella existente</span><span><i className="is-extension"/>Ampliación propuesta</span></div>
    <p className="footprint-fine">La cruz fija el origen del contorno. Muévela y ajusta el giro sin cambiar sus dimensiones. La orientación del plano se propone manualmente.</p>
  </div>;
}
