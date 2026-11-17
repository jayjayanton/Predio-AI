
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
  streets: {
    name: 'Calles',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri and contributors',
    nativeZoom: 19
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    nativeZoom: 19
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


// Keep Leaflet's canvas and tile placement synced with collapsible/resizable panels.
function ResizeWithContainer() {
  const map=useMap();
  useEffect(()=>{
    const element=map.getContainer();
    let frame=null;
    const refresh=()=>{
      if(frame!==null)cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>map.invalidateSize({pan:false,animate:false}));
    };
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(refresh):null;
    observer?.observe(element);
    window.addEventListener('resize',refresh);
    refresh();
    return ()=>{
      if(frame!==null)cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize',refresh);
    };
  },[map]);
  return null;
}

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
        maxZoom: 17
      });
    }
  }, [data, map]);

  return null;
}

// Only request features visible in the current map viewport. Never download
// the full Quito cadastre into the browser.
const PARCEL_SERVICE='https://geoquito.quito.gob.ec/server/rest/services/Hosted/predios_2026_feb/FeatureServer/5/query';
const MIN_PARCEL_ZOOM=16;
const MAX_BATCH=250;
const MAX_RENDERED=2400;
const MAX_DEPTH=5;
const MAX_QUERIES=64;


// Geometry-only preliminary screening. ArcGIS 2026 parcel features currently
// expose a predio identifier, not authoritative urban/rural or VU zoning.
function geometryAreaM2(geometry) {
  if(!geometry || !['Polygon','MultiPolygon'].includes(geometry.type)) return NaN;
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.reduce((total,rings)=>total+Math.abs(L.GeometryUtil.geodesicArea(rings[0].map(([lng,lat])=>L.latLng(lat,lng))))-
    rings.slice(1).reduce((holes,ring)=>holes+Math.abs(L.GeometryUtil.geodesicArea(ring.map(([lng,lat])=>L.latLng(lat,lng)))),0),0);
}

function VisibleParcels({enabled,criteria,highlightMatches}) {
  const map=useMap();
  const [features,setFeatures]=useState(null);
  const [status,setStatus]=useState('');
  // Retain completed features across pans, while bounding browser memory.
  const cache=React.useRef(new Map());
  useEffect(()=>{
    if(!enabled){setFeatures(null);setStatus('');return;}
    let timer=null,controller=null,seq=0;
    const publish=(bounds,message)=>{
      const visible=[];
      for(const feature of cache.current.values()){
        const box=feature._bbox;
        if(box && box[0]<=bounds.getEast()&&box[2]>=bounds.getWest()&&
           box[1]<=bounds.getNorth()&&box[3]>=bounds.getSouth())visible.push(feature);
      }
      setFeatures({type:'FeatureCollection',features:visible.map(({_bbox,...f})=>f)});
      setStatus(message);
    };
    const update=()=>{
      if(timer)clearTimeout(timer);
      if(controller)controller.abort();
      const request=++seq;
      if(map.getZoom()<MIN_PARCEL_ZOOM){
        setFeatures(null);
        setStatus('Acérquese al zoom 16 para ver los predios cercanos.');
        return;
      }
      const bounds=map.getBounds();
      publish(bounds,'Cargando predios del área visible…');
      timer=setTimeout(async()=>{
        controller=new AbortController();
        const signal=controller.signal;
        const queue=[{west:bounds.getWest(),south:bounds.getSouth(),east:bounds.getEast(),north:bounds.getNorth(),depth:0}];
        let queries=0,limited=false,completed=0;
        const requestTile=async(tile)=>{
          const params=new URLSearchParams({
            where:'1=1',
            geometry:JSON.stringify({xmin:tile.west,ymin:tile.south,xmax:tile.east,ymax:tile.north,spatialReference:{wkid:4326}}),
            geometryType:'esriGeometryEnvelope',inSR:'4326',
            spatialRel:'esriSpatialRelIntersects',outFields:'predio',
            returnGeometry:'true',outSR:'4326',
            resultRecordCount:String(MAX_BATCH+1),f:'geojson'
          });
          const response=await fetch(PARCEL_SERVICE+'?'+params,{signal});
          if(!response.ok)throw new Error('HTTP '+response.status);
          const payload=await response.json();
          if(payload.error)throw new Error(payload.error.message||'ArcGIS error');
          if(payload.type!=='FeatureCollection'||!Array.isArray(payload.features))throw new Error('GeoJSON inválido');
          return payload;
        };
        try{
          // Process independent spatial tiles in parallel to avoid long
          // sequential waits on mobile. Subdivide overflowing tiles.
          while(queue.length && queries<MAX_QUERIES && !signal.aborted){
            const batch=queue.splice(0,Math.min(4,MAX_QUERIES-queries));
            queries+=batch.length;
            const results=await Promise.all(batch.map(async tile=>({tile,payload:await requestTile(tile)})));
            for(const {tile,payload} of results){
              const overflow=payload.features.length>MAX_BATCH||payload.exceededTransferLimit;
              if(overflow){
                if(tile.depth<MAX_DEPTH){
                  const mx=(tile.west+tile.east)/2,my=(tile.south+tile.north)/2;
                  queue.push(
                    {west:tile.west,south:tile.south,east:mx,north:my,depth:tile.depth+1},
                    {west:mx,south:tile.south,east:tile.east,north:my,depth:tile.depth+1},
                    {west:tile.west,south:my,east:mx,north:tile.north,depth:tile.depth+1},
                    {west:mx,south:my,east:tile.east,north:tile.north,depth:tile.depth+1}
                  );
                }else limited=true;
                continue;
              }
              completed++;
              for(const feature of payload.features){
                if(!feature.geometry)continue;
                const key=String(feature.properties?.predio??feature.id??'')||JSON.stringify(feature.geometry);
                if(cache.current.has(key))continue;
                // Bounding box for viewport filtering, including multipolygons.
                const coords=[];
                const walk=v=>{if(!Array.isArray(v))return;if(typeof v[0]==='number'&&typeof v[1]==='number')coords.push(v);else v.forEach(walk);};
                walk(feature.geometry.coordinates);
                if(!coords.length)continue;
                const xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]);
                cache.current.set(key,{...feature,_bbox:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]});
              }
            }
            if(request!==seq||signal.aborted)return;
            // Cap retained features; recent neighborhoods are preferred.
            while(cache.current.size>5000)cache.current.delete(cache.current.keys().next().value);
            publish(bounds,completed+' áreas consultadas · cargando límites…');
          }
          if(queue.length)limited=true;
          if(request!==seq||signal.aborted)return;
          publish(bounds,'Consulta terminada'+(limited?' · cobertura parcial; acerque el mapa':'')+' · catastro 2026');
        }catch(error){
          if(error.name==='AbortError'||request!==seq)return;
          publish(bounds,'Error catastral: '+String(error.message||'Red').slice(0,85));
        }
      },300);
    };
    map.on('moveend',update);
    update();
    return ()=>{seq++;if(timer)clearTimeout(timer);if(controller)controller.abort();map.off('moveend',update);};
  },[map,enabled]);
  const min=Number(criteria?.min),max=Number(criteria?.max);
  const validRange=criteria && criteria.min!=='' && criteria.max!=='' && min>0 && max>=min;
  const advanced=criteria?.landClass!=='all'||criteria?.housingType!=='all'||criteria?.occupation!=='all';
  const areaMatches=validRange && !advanced && (features?.features||[]).filter(f=>{const a=geometryAreaM2(f.geometry);return Number.isFinite(a)&&a>=min&&a<=max;});
  const matchIds=new Set((areaMatches||[]).map(f=>String(f.properties?.predio??f.id??'')));
  const highlight=Boolean(highlightMatches&&validRange&&!advanced);
  return <>
    {features?.features?.length>0&&<GeoJSON className="predio-nearby-outline" key={JSON.stringify(features.features.map(f=>f.id||f.properties?.predio))} data={features}
      style={feature=>{const match=highlight&&matchIds.has(String(feature.properties?.predio??feature.id??''));return {color:match?'#e2a321':'#9fe7b6',weight:match?2.5:1.7,opacity:1,fillColor:match?'#ffd65c':'#9fe7b6',fillOpacity:match?0.42:0};}}
      onEachFeature={(feature,layer)=>{
        layer.bindPopup('Predio: '+String(feature.properties?.predio||'No identificado'));
        layer.on('mouseover',()=>layer.setStyle({color:'#2eae75',weight:3,fillColor:'#5bc992',fillOpacity:0.18}));
        layer.on('mouseout',()=>{const match=highlight&&matchIds.has(String(feature.properties?.predio??feature.id??''));layer.setStyle({color:match?'#e2a321':'#9fe7b6',weight:match?2.5:1.7,opacity:1,fillColor:match?'#ffd65c':'#9fe7b6',fillOpacity:match?0.42:0});});
        layer.on('click',()=>layer.setStyle({color:'#139e68',weight:3,fillColor:'#5bc992',fillOpacity:0.22}));
      }}/>}
    {highlightMatches&&<div role="status" style={{fontSize:12,padding:'6px 10px',color:'#c9e2e0',background:'#173038'}}>
      {!validRange?'Introduzca un rango de superficie válido.':advanced?'La clasificación, VU/VB/VM y ocupación requieren cruce PUGS; no se resaltan coincidencias sin verificar.':highlight?('Coincidencias preliminares por área geométrica visible: '+matchIds.size+'. No verifica PUGS ni superficie oficial.'):'Active el resaltado para ver coincidencias por área.'}
    </div>}
    {status&&<div className="leaflet-top leaflet-right" style={{pointerEvents:'none',marginTop:62}}><div className="leaflet-control" style={{background:'rgba(255,255,255,.94)',color:'#263238',padding:'5px 8px',margin:'0 8px',fontSize:11,maxWidth:180,borderRadius:6}}>{status}</div></div>}
  </>;
}

function SearchResultsLayer({results,selected,onSelect}) {
  const map=useMap();
  const [nearest,setNearest]=useState(null);
  useEffect(()=>{
    if(!results?.features?.length){setNearest(null);return;}
    const collection=L.geoJSON(results);
    const bounds=collection.getBounds();
    if(bounds.isValid())map.fitBounds(bounds,{padding:[35,35],maxZoom:15});
    const updateNearest=()=>{
      const center=map.getCenter();
      let best=null,distance=Infinity;
      collection.eachLayer(layer=>{
        if(!layer.getBounds)return;
        const id=String(layer.feature?.properties?.n_predio||'');
        const d=center.distanceTo(layer.getBounds().getCenter());
        if(id&&d<distance){best=id;distance=d;}
      });
      setNearest(best);
    };
    updateNearest();
    map.on('moveend',updateNearest);
    return ()=>map.off('moveend',updateNearest);
  },[results,map]);
  useEffect(()=>{
    if(!selected||!results?.features?.length)return;
    const feature=results.features.find(f=>String(f.properties?.n_predio)===String(selected));
    if(!feature)return;
    const bounds=L.geoJSON(feature).getBounds();
    if(bounds.isValid()){
      map.invalidateSize({pan:false,animate:false});
      map.fitBounds(bounds,{padding:[50,50],maxZoom:18});
    }
  },[selected,results,map]);
  if(!results?.features?.length)return null;
  return <>
    <GeoJSON key={JSON.stringify([results.features.map(f=>f.properties?.n_predio),selected,nearest])} data={results}
      style={feature=>{
        const id=String(feature.properties?.n_predio||'');
        // An automatically detected nearest parcel is NOT a user selection.
        const active=selected!=null&&id===String(selected);
        return {color:active?'#b86dff':'#20b7aa',weight:active?4:2,fillColor:active?'#9b4dff':'#20b7aa',fillOpacity:active?.55:.17};
      }}
      onEachFeature={(feature,layer)=>{
        const id=String(feature.properties?.n_predio||'');
        layer.bindTooltip('Predio '+id);
        layer.on('click',()=>onSelect?.(id));
      }}/>
    <div className="leaflet-bottom leaflet-right" style={{pointerEvents:'none',marginBottom:42}}>
      <div className="leaflet-control" style={{background:'#10262be8',color:'#eaf2f1',padding:'8px 10px',fontSize:12,borderRadius:8,margin:10}}>
        {results.features.length} polígonos preliminares · {selected?'Seleccionado: '+selected:'Ningún predio seleccionado'}
      </div>
    </div>
  </>;
}

// Main cadastral map component.

export default function ParcelMap({ data, criteria, searchResults, selectedSearchPredio, onSelectSearchPredio }) {
  const [basemap, setBasemap] = useState('streets');
  const [showNearbyParcels,setShowNearbyParcels]=useState(true);
  const [highlightMatches,setHighlightMatches]=useState(false);

  const selectedBasemap = BASEMAPS[basemap];

  return (
    <div className="parcel-map-wrapper">

      {/* Basemap selector */}

      <div
        style={{display:'flex',flexWrap:'wrap',gap:4,maxWidth:'100%',boxSizing:'border-box'}}
        className="basemap-switcher"
        role="group"
        aria-label="Seleccionar mapa base"
      >
        <button
          type="button"
          className={basemap === 'streets' ? 'active' : ''}
          aria-pressed={basemap === 'streets'}
          onClick={() => setBasemap('streets')}
        >
          Calles
        </button>

        <button type="button" className={basemap === 'osm' ? 'active' : ''}
          aria-pressed={basemap === 'osm'} onClick={() => setBasemap('osm')}>OSM</button>
        <button
          type="button"
          className={basemap === 'topographic' ? 'active' : ''}
          aria-pressed={basemap === 'topographic'}
          onClick={() => setBasemap('topographic')}
        >
          Topográfico
        </button>

        <button
          type="button"
          className={basemap === 'satellite' ? 'active' : ''}
          aria-pressed={basemap === 'satellite'}
          onClick={() => setBasemap('satellite')}
        >
          Satélite
        </button>
      </div>

      <label className="parcel-layer-toggle" style={{display:'flex',alignItems:'center',gap:6,margin:'8px 0',fontSize:13}}>
        <input type="checkbox" checked={showNearbyParcels} onChange={e=>setShowNearbyParcels(e.target.checked)}/>
        Predios catastrales cercanos (zoom 16+)
      </label>
      {criteria&&<label className="parcel-layer-toggle" style={{display:'flex',alignItems:'center',gap:6,margin:'8px 0',fontSize:13}}>
        <input type="checkbox" checked={highlightMatches} onChange={e=>setHighlightMatches(e.target.checked)}/>
        Resaltar predios que coinciden con los criterios
      </label>}
      {/* Leaflet map */}

      <MapContainer
        center={[-0.200, -78.430]}
        zoom={17}
        minZoom={2}
        maxZoom={19}
        zoomSnap={1}
        zoomDelta={1}
        scrollWheelZoom={true}
        zoomControl={true}
        className="map"
      >

        <ResizeWithContainer />

        {/* ArcGIS basemap */}

        <TileLayer
          key={basemap}
          url={selectedBasemap.url}
          attribution={selectedBasemap.attribution}
          maxNativeZoom={selectedBasemap.nativeZoom}
          maxZoom={19}
        />

        <VisibleParcels enabled={showNearbyParcels} criteria={criteria} highlightMatches={highlightMatches}/>
        <SearchResultsLayer results={searchResults} selected={selectedSearchPredio} onSelect={onSelectSearchPredio}/>

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
