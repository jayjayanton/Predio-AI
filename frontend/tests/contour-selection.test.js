import test from 'node:test';
import assert from 'node:assert/strict';
import {findClosedContours} from '../src/contourSelection.js';

const rectangle = (x, y, width, height) => [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
const hatch = (id, rings) => ({id, kind: 'hatch_boundary', source_type: 'HATCH', closed: true, points: [], rings});

test('contour picking selects the existing hatch outside boundary through graphical furniture masks', () => {
  const floor = hatch('floor', [rectangle(0, 0, 10, 6), rectangle(2, 2, 2, 2)]);
  const items = [floor,
    {id: 'area-label-box', kind: 'polyline', closed: true, points: rectangle(4, 3, 1, 0.3)},
    {id: 'tile-stroke', kind: 'line', hatch_pattern: true, points: [[0, 3], [10, 3]]},
    {id: 'label', kind: 'text', text: '60 m²', position: [4, 3]},
  ];
  for (const point of [[3, 3], [4.5, 3.1], [8, 5]]) {
    const result = findClosedContours(items, point);
    assert.deepEqual(result.choices.map(choice => choice.item.id), ['floor']);
    assert.equal(result.choices[0].exterior.ignoredRingCount, 1);
  }
});

test('overlapping source hatches remain separate choices and open paths are not converted into an area', () => {
  const one = hatch('one', [rectangle(0, 0, 10, 6)]);
  const two = hatch('two', [rectangle(2, 2, 10, 6)]);
  assert.deepEqual(findClosedContours([one, two], [4, 4]).choices.map(choice => choice.item.id), ['one', 'two']);
  assert.deepEqual(findClosedContours([{id: 'open', kind: 'polyline', points: [[0, 0], [10, 0], [10, 6]]}], [4, 4]),
    {choices: [], reason: 'no_contour'});
  assert.equal(findClosedContours([one], [20, 20]).reason, 'no_contour');
  assert.equal(findClosedContours(Array.from({length: 65}, (_, index) => ({...one, id: String(index)})), [4, 4]).reason, 'complexity_limit');
});

test('contour picking caps combined validation work across overlapping complex sources', () => {
  const circle = Array.from({length: 1500}, (_, i) => [Math.cos(i * Math.PI / 750), Math.sin(i * Math.PI / 750)]);
  const result = findClosedContours([hatch('one', [circle]), hatch('two', [circle])], [0, 0]);
  assert.deepEqual(result, {choices: [], reason: 'complexity_limit'});
});
