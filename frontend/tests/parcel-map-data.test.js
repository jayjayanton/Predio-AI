import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createParcelTileCache, loadParcelTiles, viewportTiles, geometryBounds,
  collectionBounds, splitParcelTile, NEARBY_RENDER_LIMIT
} from '../src/parcelMapData.js';

const tile={x:-15700,y:-40,west:-78.5,south:-0.2,depth:0,path:''};
const feature=(id,x=-78.499,y=-0.199)=>({type:'Feature',id,properties:{predio:String(id)},
  geometry:{type:'Polygon',coordinates:[[[x,y],[x+.0001,y],[x+.0001,y+.0001],[x,y+.0001],[x,y]]]}});
const collection=features=>({type:'FeatureCollection',features});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('returning to a completely retrieved area reuses tiles without another request',async()=>{
  const cache=createParcelTileCache({source:'2026'});let calls=0;
  const fetchTile=async()=>{calls++;return collection([feature(1)]);};
  const first=await loadParcelTiles(cache,[tile],{fetchTile});
  const second=await loadParcelTiles(cache,[tile],{fetchTile});
  assert.equal(calls,1);assert.equal(first.queries,1);assert.equal(second.queries,0);
  assert.equal(second.limited,false);assert.equal(cache.visible([-78.5,-.2,-78.49,-.19]).features.length,1);
});

test('overflow is subdivided once and never cached as a complete parent response',async()=>{
  const cache=createParcelTileCache({source:'2026'});let calls=0;
  const fetchTile=async current=>{
    calls++;
    return current.depth===0
      ?{...collection([feature('discarded-partial')]),properties:{exceededTransferLimit:true}}
      :collection([feature(current.path)]);
  };
  const first=await loadParcelTiles(cache,[tile],{fetchTile});
  assert.equal(first.limited,false);assert.equal(calls,5);
  assert.equal(cache.get(tile).kind,'split');assert.equal(cache.isComplete(tile),true);
  assert.equal(cache.visible([-79,-1,-78,0]).features.some(f=>f.id==='discarded-partial'),false);
  await loadParcelTiles(cache,[tile],{fetchTile});assert.equal(calls,5);
});

test('query/depth limits and evicted children remain explicitly partial',async()=>{
  const cache=createParcelTileCache({source:'2026'});
  const fetchTile=async()=>({...collection([]),exceededTransferLimit:true});
  const result=await loadParcelTiles(cache,[tile],{fetchTile,maxDepth:1});
  assert.equal(result.limited,true);assert.equal(cache.isComplete(tile),false);
  const tiny=createParcelTileCache({source:'2026',maxTiles:2});
  const parts=splitParcelTile(tile);
  await loadParcelTiles(tiny,parts,{fetchTile:async current=>collection([feature(current.path)])});
  assert.equal(parts.every(tiny.isComplete),false);
});

test('concurrent callers share a tile and cancellation does not stop its remaining consumer',async()=>{
  const cache=createParcelTileCache({source:'2026'});const gate=deferred();let calls=0,requestSignal;
  const fetchTile=async(_tile,signal)=>{calls++;requestSignal=signal;return gate.promise;};
  const firstController=new AbortController(),secondController=new AbortController();
  const first=cache.fetch(tile,fetchTile,firstController.signal);
  const second=cache.fetch(tile,fetchTile,secondController.signal);
  const rejected=assert.rejects(first,{name:'AbortError'});
  await tick();assert.equal(calls,1);
  firstController.abort();await rejected;assert.equal(requestSignal.aborted,false);
  gate.resolve(collection([feature(9)]));await second;
  assert.equal(cache.isComplete(tile),true);assert.equal(calls,1);
});

test('aborting the last consumer cancels transport and does not publish stale geometry',async()=>{
  const cache=createParcelTileCache({source:'2026'});const gate=deferred();let requestSignal;
  const controller=new AbortController();
  const work=cache.fetch(tile,async(_tile,signal)=>{requestSignal=signal;return gate.promise;},controller.signal);
  const rejected=assert.rejects(work,{name:'AbortError'});
  await tick();controller.abort();await rejected;assert.equal(requestSignal.aborted,true);
  gate.resolve(collection([feature(99)]));await tick();assert.equal(cache.get(tile),null);
  await cache.fetch(tile,async()=>collection([feature(100)]));
  assert.equal(cache.visible([-79,-1,-78,0]).features[0].id,100);
});

test('expiration and source changes cannot reuse old municipal geometry',async()=>{
  let now=0,calls=0;const fetchTile=async()=>collection([feature(++calls)]);
  const cache=createParcelTileCache({source:'2026',ttlMs:10,now:()=>now});
  await cache.fetch(tile,fetchTile);now=11;
  assert.equal(cache.visible([-79,-1,-78,0]).features.length,0);
  await cache.fetch(tile,fetchTile);assert.equal(calls,2);
  const older=createParcelTileCache({source:'2024'});await older.fetch(tile,fetchTile);
  assert.equal(calls,3);assert.equal(cache.visible([-79,-1,-78,0]).features[0].id,2);
});

test('newest overlapping tile wins before viewport filtering even when load timestamps tie',async()=>{
  const cache=createParcelTileCache({source:'2026',now:()=>0});
  const neighbor={...tile,x:tile.x+1,west:tile.west+.005};
  const original=feature(7,-78.499),moved=feature(7,-78.494);
  await cache.fetch(tile,async()=>collection([original]));
  await cache.fetch(neighbor,async()=>collection([moved]));
  cache.get(tile); // LRU access must not make the older geometry authoritative.
  assert.deepEqual(cache.visible([-78.5,-.2,-78.495,-.19]).features,[]);
  assert.equal(cache.visible([-78.5,-.2,-78.49,-.19]).features[0],moved);
});

test('render budget is enforced while retaining an explicitly selected visible feature',async()=>{
  const cache=createParcelTileCache({source:'2026'});
  for(let index=0;index<12;index++){
    const current={...tile,x:tile.x+index,west:tile.west+.005*index};
    await cache.fetch(current,async()=>collection(Array.from({length:250},(_,offset)=>
      feature(index*250+offset,current.west+offset*.000001,-.199))));
  }
  const visible=cache.visible([-78.5,-.2,-78.43,-.19],{selected:'2999'});
  assert.equal(visible.features.length,NEARBY_RENDER_LIMIT);assert.equal(visible.available,3000);
  assert.equal(visible.limited,true);assert.ok(visible.features.some(f=>f.id===2999));
});

test('one shared cache bounds simultaneous network activity across callers',async()=>{
  const cache=createParcelTileCache({source:'2026',concurrency:2});let active=0,peak=0;
  const fetchTile=async current=>{active++;peak=Math.max(peak,active);await tick();active--;return collection([feature(current.x)]);};
  await Promise.all(Array.from({length:8},(_,index)=>cache.fetch({...tile,x:tile.x+index},fetchTile)));
  assert.equal(peak,2);
});

test('bounds include multipart shells and holes without constructing Leaflet layers',()=>{
  const geometry={type:'MultiPolygon',coordinates:[feature(1,-78.5,-.2).geometry.coordinates,feature(2,-78.4,-.1).geometry.coordinates]};
  assert.deepEqual(geometryBounds(geometry),[-78.5,-.2,-78.3999,-.0999]);
  assert.deepEqual(collectionBounds(collection([{geometry}])),geometryBounds(geometry));
  assert.equal(geometryBounds({type:'Polygon',coordinates:[]}),null);
  const narrow=viewportTiles([0,.0001,.12,.0002]);assert.equal(narrow.limited,false);assert.equal(narrow.tiles.length,25);
  const enormous=viewportTiles([-180,-90,180,90]);assert.equal(enormous.tiles.length,64);assert.equal(enormous.limited,true);
});
