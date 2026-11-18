import test from 'node:test';
import assert from 'node:assert/strict';
import {addProjectSelection, removeProjectSelection, summarizeProjectSelections, PROJECT_SELECTION_LIMIT} from '../src/projectMeasurements.js';

const area = {id:'a',room:'Sala',source:'Planta baja.pdf',kind:'floor_area',view:'Página 1',viewIndex:0,
  elementIds:['room-outline'],metresPerUnit:0.01,metric:{value:17.1,perimeter:16.6}};
const height = {id:'h',room:'Sala',source:'Corte A-A.dwg',kind:'room_height',view:'Espacio modelo',
  elementIds:['vertical-wall'],metresPerUnit:1,metric:{value:2.7}};

test('combines independently calibrated sources only when the room matches',()=>{
  const selections=addProjectSelection(addProjectSelection([],area),height);
  const [room]=summarizeProjectSelections(selections);
  assert.ok(Math.abs(room.volume - 46.17) < 1e-10);
  assert.equal(room.floorArea,17.1);
  assert.equal(room.height,2.7);
  assert.equal(room.items[1].source,'Corte A-A.dwg');
  assert.equal(room.volumeStatus,'constant_height_assumed');
});
test('does not fabricate a volume without cross-section evidence',()=>{
  const [room]=summarizeProjectSelections(addProjectSelection([],area));
  assert.equal(room.volume,null);assert.equal(room.volumeStatus,'pending_evidence');
});
test('does not silently choose between conflicting heights',()=>{
  const selections=addProjectSelection(addProjectSelection(addProjectSelection([],area),height),
    {...height,id:'h2',metric:{value:3.1}});
  const [room]=summarizeProjectSelections(selections);
  assert.equal(room.volume,null);assert.equal(room.ambiguous,true);
});
test('rejects unscaled, missing, invalid and excessive evidence',()=>{
  assert.equal(addProjectSelection([],{...area,metresPerUnit:null}).length,0);
  assert.equal(addProjectSelection([],{...area,metric:{value:NaN,perimeter:3}}).length,0);
  assert.equal(addProjectSelection([],{...area,elementIds:[]}).length,0);
  assert.equal(addProjectSelection([],{...height,metric:{value:Infinity}}).length,0);
  const many=Array.from({length:PROJECT_SELECTION_LIMIT},(_,i)=>({...area,id:String(i)}));
  assert.equal(addProjectSelection(many,area),many);
});
test('removing selection invalidates the combined volume',()=>{
  const records=addProjectSelection(addProjectSelection([],area),height);
  const remaining=removeProjectSelection(records,'h');
  assert.equal(summarizeProjectSelections(remaining)[0].volume,null);
});
