import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlanningRequest, candidateField, initialPlannerDraft, localPlanningExport, localSvgPath, nudgePlacement,
  parcelEdges, placedPlanningExport, plannerContextKey, planningBounds, polygonArea, readCandidateNumber,
  selectedParcelGeometry, usableFootprint} from '../src/footprintPlanning.js';

const ring = (x, y, w, h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const footprint = {type:'Polygon',coordinates:[ring(-5,-4,10,8),ring(-1,-1,2,2)]};
const snapshot = () => ({coordinateSpace:'local_metres',source:{documentName:'independent.dwg',viewName:'Model',entityId:'42'},
  scale:{metresPerUnit:0.001,method:'unit',unit:'mm'},origin:[5000,4000],footprint:structuredClone(footprint),
  shapes:[{id:'table',label:'Mesa',role:'furniture',geometry:{type:'Polygon',coordinates:[ring(1,1,2,1)]}},
    {id:'addition',label:'Ampliación',role:'extension',geometry:{type:'Polygon',coordinates:[ring(4,-2,3,4)]}}]});
const parcel = {type:'Polygon',coordinates:[ring(-78.5,-.2,.0003,.0003)]};
const properties = {n_predio:'123456'};
const irm = {candidate_irm_fields:{predio:{raw:'123456'},area_terreno:{raw:'1.250,50',page:2,evidence:'Área terreno: 1.250,50 m2'},cos_pb:{raw:'50',page:3}}};
function build(extra = {}) {
  const params = {snapshot:snapshot(),geometry:parcel,properties,blueprint:null,irm,...extra};
  params.draft ||= initialPlannerDraft(params);
  return buildPlanningRequest(params);
}

test('local footprint preserves holes, scale provenance and coordinate space without pretending to be geographic GeoJSON', () => {
  const value = snapshot(); const before = structuredClone(value);
  assert.equal(usableFootprint(value),true);
  assert.equal(polygonArea(value.footprint),76);
  assert.deepEqual(planningBounds(value),[-5,-4,7,4]);
  assert.match(localSvgPath(value.footprint),/^M-5,4 /);
  const exported = localPlanningExport(value);
  assert.equal(exported.coordinate_space,'local_metres');
  assert.equal(exported.geographic_crs,null);
  assert.equal(exported.type,undefined);
  assert.equal(exported.verified,false);
  assert.deepEqual(exported.footprint.coordinates[1],footprint.coordinates[1]);
  assert.deepEqual(value,before);
  assert.equal(localPlanningExport({...value,scale:null}),null);
  assert.equal(usableFootprint({...value,coordinateSpace:'EPSG:4326'}),false);
});

test('candidate numeric parsing is explicit and keeps missing or ambiguous values pending', () => {
  assert.equal(readCandidateNumber('1.250,50'),1250.5);
  assert.equal(readCandidateNumber('1,250.50'),1250.5);
  assert.equal(readCandidateNumber('50,2'),50.2);
  for(const value of ['',null,undefined,true,Infinity,'12 m2','1e4'])assert.equal(readCandidateNumber(value),null);
  assert.deepEqual(candidateField(irm,'area_terreno'),{text:'1250.5',evidence:'Área terreno: 1.250,50 m2',page:2});
  assert.equal(candidateField({candidate_irm_fields:{cos_pb:{raw:'50',ambiguous:true}}},'cos_pb').text,'');
});

test('drawing-only analysis never creates a parcel, IRM or reviewed association', () => {
  const built=build({geometry:null,properties:{},irm:null});
  assert.equal(built.error,'');
  assert.equal(built.request.parcel,null);assert.equal(built.request.placement,null);
  assert.equal(built.request.irm.provided,false);assert.equal(built.request.irm.reviewed,false);
  assert.equal(built.request.irm.association_confirmed,false);assert.equal(built.request.irm.irm_predio,null);
  assert.equal(built.request.proposal.ground_floor_confirmed,false);
  assert.equal(built.request.proposal.existing_footprint_complete,false);
  assert.deepEqual(built.request.shapes.map(s=>s.role),['furniture','extension']);
});

test('source fields and user review stay separate and known mismatches cannot be affirmed away', () => {
  const draft=initialPlannerDraft({geometry:parcel,properties,irm});
  assert.equal(draft.fields.area_terreno,'1250.5');assert.equal(draft.reviewed,false);
  const normal=build({draft:{...draft,reviewed:true,associationConfirmed:true,fullGroundFootprint:true}}).request;
  assert.equal(normal.irm.association_confirmed,true);
  assert.equal(normal.proposal.ground_floor_confirmed,true);
  assert.equal(normal.placement.confirmed,false);
  const otherIrm={...irm,candidate_irm_fields:{...irm.candidate_irm_fields,predio:{raw:'999999'}}};
  const mismatch=build({irm:otherIrm,draft:{...draft,reviewed:true,associationConfirmed:true,manualIrmPredio:'123456'}}).request;
  assert.equal(mismatch.irm.irm_predio,'999999');assert.equal(mismatch.irm.association_confirmed,false);
  const noIdentifier={candidate_irm_fields:{}};
  const typed=build({irm:noIdentifier,draft:{...draft,manualIrmPredio:'999999',associationConfirmed:true}}).request;
  assert.equal(typed.irm.irm_predio,'999999');assert.equal(typed.irm.association_confirmed,false);
  assert.match(build({irm:noIdentifier,draft:{...draft,manualIrmPredio:'invalid'}}).error,/solo dígitos/);
});

test('IRM hazards and horizontal property evidence survive user review toggles', () => {
  const flagged={...irm,planning_evidence:{property_regime:'horizontal',flags:[
    {kind:'horizontal_property',page:1},{kind:'special_restrictions',page:2},{kind:'special_restrictions',page:3},{kind:'multiple_parameter_sets',page:4}]}};
  const draft={...initialPlannerDraft({geometry:parcel,properties,irm:flagged}),regime:'individual',reviewed:true,restrictions:'none',zone:'single'};
  const request=build({irm:flagged,draft}).request;
  assert.equal(request.irm.property_regime,'horizontal');
  assert.deepEqual(request.irm.evidence_flags,['horizontal_property','special_restrictions','multiple_parameter_sets']);
});

test('gross footprint and countable ground area remain separate until explicitly reviewed', () => {
  const draft=initialPlannerDraft({geometry:parcel,properties,irm});
  const pending=build({draft}).request;
  assert.equal(pending.proposal.footprint_is_counted_area,false);
  assert.equal(pending.proposal.ground_floor_counted_area_m2,null);
  const zero=build({draft:{...draft,proposal:{...draft.proposal,ground_floor_counted_area_m2:'0'}}}).request;
  assert.equal(zero.proposal.ground_floor_counted_area_m2,0);
  assert.equal(zero.proposal.footprint_is_counted_area,false);
  const declared=build({draft:{...draft,footprintIsCountedArea:true,proposal:{...draft.proposal,ground_floor_counted_area_m2:'70'}}}).request;
  assert.equal(declared.proposal.footprint_is_counted_area,true);
  assert.equal(declared.proposal.ground_floor_counted_area_m2,null,'the two mutually exclusive references are not sent together');
});

test('only an unambiguous selected property supplies the parcel geometry', () => {
  const feature = id=>({type:'Feature',properties:{n_predio:id},geometry:parcel});
  const collection={type:'FeatureCollection',features:[feature('123456'),feature('999999')]};
  assert.equal(selectedParcelGeometry(collection,{}),null);
  assert.deepEqual(selectedParcelGeometry(collection,properties),parcel);
  assert.equal(selectedParcelGeometry(collection,{n_predio:'000000'}),null);
  const split={type:'FeatureCollection',features:[feature('123456'),feature('123456')]};
  assert.equal(selectedParcelGeometry(split,properties).type,'MultiPolygon');
  assert.equal(parcelEdges(parcel).length,4);
  assert.equal(parcelEdges({type:'Polygon',coordinates:[...parcel.coordinates,ring(-78.4999,-.1999,.00001,.00001)]}).length,4,'inner holes are not silently treated as road frontages');
});

test('placement and edge input are numeric, explicit, and reset review on a nudge', () => {
  const draft=initialPlannerDraft({geometry:parcel,properties,irm});
  const request=build({draft:{...draft,placement:{latitude:'-0,2',longitude:'-78,5',rotation_degrees:'90',confirmed:true},edgeKinds:{'0:0:0':'front','0:0:1':'side','0:0:2':'rear','0:0:99':'front'}}}).request;
  assert.deepEqual(request.placement,{latitude:-.2,longitude:-78.5,rotation_degrees:90,confirmed:true});
  assert.equal(request.edges.length,3);assert.equal(request.edges[0].kind,'front');
  const moved=nudgePlacement(request.placement,1,0);
  assert.equal(moved.confirmed,false);assert.ok(Number(moved.longitude)>-78.5);
  assert.equal(nudgePlacement({latitude:'90',longitude:'0'},1,0),null);
  assert.match(build({draft:{...draft,placement:{latitude:'Infinity',longitude:'-78',rotation_degrees:'0'}}}).error,/latitud/);
  assert.match(build({draft:{...draft,fields:{...draft.fields,cos_pb:'101'}}}).error,/COS/);
  assert.match(build({draft:{...draft,proposal:{height_m:'',floors:'1.5',total_floor_area_m2:''}}}).error,/pisos/);
});

test('shape edits preserve context but another source, scale, parcel, or IRM clears reviewed context', () => {
  const original=snapshot(); const key=plannerContextKey(original,parcel,irm,properties);
  assert.equal(plannerContextKey({...original,shapes:[]},parcel,irm,properties),key);
  assert.notEqual(plannerContextKey({...original,scale:{metresPerUnit:1}},parcel,irm,properties),key);
  assert.notEqual(plannerContextKey({...original,source:{...original.source,documentName:'another.dwg'}},parcel,irm,properties),key);
  assert.notEqual(plannerContextKey(original,null,irm,properties),key);
  assert.notEqual(plannerContextKey(original,parcel,null,properties),key);
});

test('only server-produced geographic output can be exported as an unverified proposed GeoJSON', () => {
  assert.equal(placedPlanningExport({},snapshot(),properties),null);
  const result={placed:{type:'FeatureCollection',features:[{type:'Feature',geometry:parcel,properties:{role:'existing',verified:false}}],placement:{latitude:-.2,longitude:-78.5}}};
  const out=placedPlanningExport(result,snapshot(),properties);
  assert.equal(out.type,'FeatureCollection');assert.equal(out.properties.verified,false);
  assert.equal(out.properties.placement_method,'user_positioned');assert.equal(out.properties.selected_predio,'123456');
  assert.deepEqual(out.features,result.placed.features);
});
