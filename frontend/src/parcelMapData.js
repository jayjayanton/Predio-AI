// Display-only retrieval helpers. Cache identities include the municipal source;
// these polygons must never replace the exact source geometry used by analysis.
export const NEARBY_TILE_SIZE = 0.005;
export const NEARBY_BATCH_SIZE = 250;
export const NEARBY_RENDER_LIMIT = 2400;

const abortError = () => new DOMException('La consulta fue cancelada.', 'AbortError');
const boundsMemo = new WeakMap();

export function geometryBounds(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  if (boundsMemo.has(geometry)) return boundsMemo.get(geometry);
  let west=Infinity, south=Infinity, east=-Infinity, north=-Infinity;
  const walk = coordinates => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      const [x,y] = coordinates;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        west=Math.min(west,x); south=Math.min(south,y);
        east=Math.max(east,x); north=Math.max(north,y);
      }
    } else coordinates.forEach(walk);
  };
  walk(geometry.coordinates);
  const bounds = Number.isFinite(west) ? [west,south,east,north] : null;
  boundsMemo.set(geometry,bounds);
  return bounds;
}

export function collectionBounds(collection) {
  const bounds=(collection?.features||[]).map(feature=>geometryBounds(feature.geometry)).filter(Boolean);
  if (!bounds.length) return null;
  return bounds.reduce((all,box)=>[
    Math.min(all[0],box[0]),Math.min(all[1],box[1]),
    Math.max(all[2],box[2]),Math.max(all[3],box[3])
  ], [...bounds[0]]);
}

const intersects = (a,b) => a[0]<=b[2] && a[2]>=b[0] && a[1]<=b[3] && a[3]>=b[1];
const centerDistance = (box,center) => ((box[0]+box[2])/2-center[0])**2 + ((box[1]+box[3])/2-center[1])**2;
const tileKey = tile => `${tile.x}:${tile.y}:${tile.depth||0}:${tile.path||''}`;

export function tileBounds(tile) {
  const size=NEARBY_TILE_SIZE / 2**(tile.depth||0);
  return [tile.west,tile.south,tile.west+size,tile.south+size];
}

export function splitParcelTile(tile) {
  const size=NEARBY_TILE_SIZE / 2**((tile.depth||0)+1);
  return [[0,0],[1,0],[0,1],[1,1]].map(([dx,dy],index)=>({
    ...tile,depth:(tile.depth||0)+1,path:(tile.path||'')+index,
    west:tile.west+dx*size,south:tile.south+dy*size
  }));
}

export function viewportTiles(bounds, maximum=64) {
  const [west,south,east,north]=bounds;
  if (!bounds.every(Number.isFinite) || west>east || south>north) return {tiles:[],limited:true};
  const x0=Math.floor(west/NEARBY_TILE_SIZE),x1=Math.floor(east/NEARBY_TILE_SIZE);
  const y0=Math.floor(south/NEARBY_TILE_SIZE),y1=Math.floor(north/NEARBY_TILE_SIZE);
  const total=(x1-x0+1)*(y1-y0+1);
  const cx=Math.floor((west+east)/2/NEARBY_TILE_SIZE),cy=Math.floor((south+north)/2/NEARBY_TILE_SIZE);
  // A bounded center-out subset also makes a pathological extent safe.
  const radius=Math.ceil(Math.sqrt(maximum));
  const tiles=[];
  for(let x=total<=maximum?x0:Math.max(x0,cx-radius);x<=(total<=maximum?x1:Math.min(x1,cx+radius));x++)
    for(let y=total<=maximum?y0:Math.max(y0,cy-radius);y<=(total<=maximum?y1:Math.min(y1,cy+radius));y++)
      tiles.push({x,y,west:x*NEARBY_TILE_SIZE,south:y*NEARBY_TILE_SIZE,depth:0,path:''});
  const center=[(west+east)/2,(south+north)/2];
  tiles.sort((a,b)=>centerDistance(tileBounds(a),center)-centerDistance(tileBounds(b),center));
  return {tiles:tiles.slice(0,maximum),limited:total>maximum};
}

function requestLimiter(maximum) {
  let active=0;
  const waiting=[];
  const drain=()=>{
    while(active<maximum && waiting.length){
      const item=waiting.shift();
      item.signal.removeEventListener('abort',item.cancel);
      if(item.signal.aborted){item.reject(abortError());continue;}
      active++;
      Promise.resolve().then(item.task).then(item.resolve,item.reject).finally(()=>{active--;drain();});
    }
  };
  return (task,signal)=>new Promise((resolve,reject)=>{
    if(signal.aborted){reject(abortError());return;}
    const item={task,signal,resolve,reject};
    item.cancel=()=>{const index=waiting.indexOf(item);if(index>=0)waiting.splice(index,1);reject(abortError());};
    signal.addEventListener('abort',item.cancel,{once:true});
    waiting.push(item);drain();
  });
}

export function createParcelTileCache({source,ttlMs=900000,maxTiles=256,maxFeatures=5000,concurrency=4,now=Date.now}={}) {
  if(!source)throw new Error('A municipal source is required for the tile cache.');
  const entries=new Map(),inflight=new Map();
  const limit=requestLimiter(concurrency);
  let featureCount=0,revision=0;
  const key=tile=>source+'|'+tileKey(tile);
  const remove=id=>{const old=entries.get(id);if(old){featureCount-=old.features?.length||0;entries.delete(id);}};
  const get=tile=>{
    const id=key(tile),entry=entries.get(id);
    if(!entry)return null;
    if(now()-entry.created>=ttlMs){remove(id);return null;}
    entries.delete(id);entries.set(id,entry);
    return entry;
  };
  const put=(tile,entry)=>{
    const id=key(tile);remove(id);
    entries.set(id,{...entry,tile,created:now(),revision:++revision});
    featureCount+=entry.features?.length||0;
    while(entries.size>maxTiles || featureCount>maxFeatures)remove(entries.keys().next().value);
  };
  const isComplete=tile=>{
    const entry=get(tile);
    return Boolean(entry && (entry.kind==='complete' || entry.children.every(isComplete)));
  };
  const fetch=async(tile,fetchTile,signal)=>{
    if(signal?.aborted)throw abortError();
    const cached=get(tile);
    if(cached)return cached;
    const id=key(tile);
    let pending=inflight.get(id);
    if(!pending){
      pending={controller:new AbortController(),consumers:0,settled:false};
      const record=pending;
      record.promise=limit(async()=>{
        const payload=await fetchTile(tile,record.controller.signal);
        if(record.controller.signal.aborted)throw abortError();
        if(payload?.error || payload?.type!=='FeatureCollection' || !Array.isArray(payload.features))
          throw new Error(payload?.error?.message||'GeoJSON municipal inválido');
        const overflow=payload.features.length>NEARBY_BATCH_SIZE ||
          payload.exceededTransferLimit===true || payload.properties?.exceededTransferLimit===true;
        const entry=overflow ? {kind:'split',children:splitParcelTile(tile)}
          : {kind:'complete',features:payload.features.filter(feature=>geometryBounds(feature.geometry))};
        put(tile,entry);
        return entry;
      },record.controller.signal).finally(()=>{
        record.settled=true;
        if(inflight.get(id)===record)inflight.delete(id);
      });
      inflight.set(id,record);
    }
    const record=pending;
    record.consumers++;
    return new Promise((resolve,reject)=>{
      let finished=false;
      const finish=(callback,value)=>{
        if(finished)return;
        finished=true;signal?.removeEventListener('abort',cancel);record.consumers--;
        callback(value);
        if(!record.consumers && !record.settled){
          if(inflight.get(id)===record)inflight.delete(id);
          record.controller.abort();
        }
      };
      const cancel=()=>finish(reject,abortError());
      signal?.addEventListener('abort',cancel,{once:true});
      record.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
      if(signal?.aborted)cancel();
    });
  };
  const visible=(bounds,{maximum=NEARBY_RENDER_LIMIT,selected=null}={})=>{
    const found=new Map();
    for(const [id,entry] of entries){
      if(now()-entry.created>=ttlMs){remove(id);continue;}
      for(const feature of entry.features||[]){
        const box=geometryBounds(feature.geometry);
        if(!box)continue;
        const identifier=feature.id??feature.properties?.objectid??feature.properties?.predio;
        // ArcGIS normally supplies a feature ID. Without one, object identity
        // avoids conflating distinct geometries with missing identifiers.
        const identity=identifier==null?feature:String(identifier);
        const previous=found.get(identity);
        // Neighboring tiles can contain the same parcel. LRU access changes
        // iteration order, so explicitly retain the most recently loaded shape.
        if(!previous || entry.revision>previous.revision)
          found.set(identity,{feature,box,revision:entry.revision});
      }
    }
    const center=[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2];
    // Apply the viewport after freshness: an older overlapping tile must not
    // resurrect a parcel whose refreshed shape has moved outside this view.
    const rows=[...found.values()].filter(row=>intersects(row.box,bounds));
    if(rows.length>maximum)rows.sort((a,b)=>{
      const selectedA=String(a.feature.properties?.predio??a.feature.id)===String(selected);
      const selectedB=String(b.feature.properties?.predio??b.feature.id)===String(selected);
      return Number(selectedB)-Number(selectedA)||centerDistance(a.box,center)-centerDistance(b.box,center);
    });
    const features=rows.slice(0,maximum).map(row=>row.feature);
    const identity=feature=>String(feature.id??feature.properties?.objectid??feature.properties?.predio??'');
    features.sort((a,b)=>identity(a)<identity(b)?-1:identity(a)>identity(b)?1:0);
    return {features,available:rows.length,limited:rows.length>maximum};
  };
  const clear=()=>{
    for(const pending of inflight.values())pending.controller.abort();
    inflight.clear();entries.clear();featureCount=0;
  };
  return {get,fetch,isComplete,visible,clear,source};
}

export async function loadParcelTiles(cache,tiles,{fetchTile,signal,maxQueries=64,maxDepth=5,onProgress=()=>{}}) {
  const queue=[...tiles];
  let queries=0,completed=0,limited=false;
  while(queue.length){
    if(signal?.aborted)throw abortError();
    const group=queue.splice(0,4);
    const results=await Promise.all(group.map(async tile=>{
      const cached=cache.get(tile);
      if(cached)return {tile,entry:cached};
      if(queries>=maxQueries){limited=true;return {tile,entry:null};}
      queries++;
      return {tile,entry:await cache.fetch(tile,fetchTile,signal)};
    }));
    for(const {tile,entry} of results){
      if(!entry)continue;
      if(entry.kind==='complete')completed++;
      else if(tile.depth<maxDepth)queue.push(...entry.children);
      else limited=true;
    }
    onProgress({queries,completed});
  }
  return {queries,completed,limited:limited||!tiles.every(cache.isComplete)};
}
