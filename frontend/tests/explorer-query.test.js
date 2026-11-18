import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerQueryClient, explorerOrdering, mergeExplorerFeatures } from '../src/explorerQuery.js';

const feature = index => ({type:'Feature', id:index+1, properties:{fid:index+1,n_predio:String(index+1)},
  geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]],[[.5,.5],[.5,1],[1,1],[1,.5],[.5,.5]]]}});
function fixture(options={}) {
  const requests=[];
  const fetcher=async (url,{signal})=>{
    assert.equal(signal.aborted,false);
    const params=Object.fromEntries(new URL(url).searchParams);requests.push(params);
    return {ok:true,json:async()=>params.returnCountOnly ? {count:1500} : {
      type:'FeatureCollection',features:Array.from({length:Math.min(Number(params.resultRecordCount),1500-Number(params.resultOffset))},(_,i)=>feature(Number(params.resultOffset)+i))
    }};
  };
  return {requests,client:createExplorerQueryClient({fetcher,...options})};
}
const definition={where:'area_terre >= 500',orderByFields:explorerOrdering('id')};

test('overlapping pages and a larger overview reuse source rows and one filter count',async()=>{
  const {client,requests}=fixture();const query=client.open(definition);
  await Promise.all([query.count(),query.range(0,50)]);
  await query.range(0,1000);
  assert.deepEqual(requests.map(p=>p.returnCountOnly?'count':[p.resultOffset,p.resultRecordCount]),['count',['0','50'],['50','950']]);
  const again=client.open(definition);
  assert.equal(await again.count(),1500);
  assert.equal((await again.range(50,50))[0].properties.n_predio,'51');
  assert.equal((await again.range(0,200)).length,200);
  assert.equal(requests.length,3,'page navigation and card layout changes reuse complete cached rows');
  const expanded=await again.range(0,1500);
  assert.equal(expanded.length,1500);
  assert.deepEqual([requests.at(-1).resultOffset,requests.at(-1).resultRecordCount],['1000','500']);
});

test('filters, ordering, source and expiry cannot substitute a different cached page',async()=>{
  let now=0;const {client,requests}=fixture({now:()=>now,ttlMs:100});
  const first=client.open(definition);await first.count();await first.range(0,10);
  const sorted=client.open({...definition,orderByFields:explorerOrdering('largest')});
  await sorted.count();await sorted.range(0,10);
  assert.equal(requests.filter(p=>p.returnCountOnly).length,1,'ordering does not change a filter count');
  await client.open({...definition,where:'area_terre >= 1000'}).range(0,10);
  await client.open({...definition,source:'https://example.test/different-source/query'}).range(0,10);
  assert.equal(requests.length,5);
  now=101;const fresh=client.open(definition);
  assert.notEqual(fresh.id,first.id);await fresh.count();await fresh.range(0,10);
  assert.equal(requests.length,7,'expiry refreshes count and geometry together');
});

test('overview and current-page merge preserves holes and includes later-page selection',async()=>{
  const {client}=fixture();const query=client.open(definition);
  const overview={type:'FeatureCollection',features:await query.range(0,1000)};
  const cachedPage={type:'FeatureCollection',features:await query.range(50,50)};
  assert.equal(mergeExplorerFeatures(overview,cachedPage),overview,'stable overview identity when the page is already present');
  const later={type:'FeatureCollection',features:await query.range(1000,50)};
  const merged=mergeExplorerFeatures(overview,later);
  assert.equal(merged.features.length,1050);
  assert.ok(merged.features.find(f=>f.properties.n_predio==='1001'));
  assert.deepEqual(merged.features[0].geometry,feature(0).geometry,'native holes remain untouched');
});

test('a truncated GeoJSON page is continued until its requested range is complete',async()=>{
  const offsets=[];
  const client=createExplorerQueryClient({fetcher:async url=>{
    const params=new URL(url).searchParams;const offset=Number(params.get('resultOffset'));offsets.push(offset);
    return {ok:true,json:async()=>({type:'FeatureCollection',properties:{exceededTransferLimit:offset===0},features:Array.from({length:offset===0?2:3},(_,i)=>feature(offset+i))})};
  }});
  assert.equal((await client.open(definition).range(0,5)).length,5);
  assert.deepEqual(offsets,[0,2]);
});

test('late success after cancellation cannot populate a future cached page',async()=>{
  let release;let calls=0;
  const client=createExplorerQueryClient({fetcher:async()=>{calls++;return new Promise(resolve=>release=()=>resolve({ok:true,json:async()=>({type:'FeatureCollection',features:[feature(0)]})}));}});
  const query=client.open(definition);const controller=new AbortController();
  const pending=query.range(0,1,controller.signal);controller.abort();release();
  await assert.rejects(pending,{name:'AbortError'});
  const retry=query.range(0,1);release();await retry;
  assert.equal(calls,2);
});
