import test from 'node:test';
import assert from 'node:assert/strict';
import { SELECTION_LIMIT, parseSelection, selectionCSV, selectionRecord } from '../src/selection.js';

const savedAt = '2026-11-17T12:00:00.000Z';
const parcel = (overrides = {}) => ({
  n_predio: '627739',
  clave_cata: '0012345678',
  parroquia: 'CUMBAYÁ',
  tipo_propi: 'PROPIEDAD HORIZONTAL',
  zonificaci: 'URBANO',
  area_terre: 2400,
  area_ter_1: 120,
  area_const: 0,
  frente: 24,
  ...overrides,
});

// Read the public CSV format independently of its writer, including quoted
// commas, escaped quotes and newlines within a cell.
function readCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const character = input[i];
    if (character === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if (character === '\r' && input[i + 1] === '\n' && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += character;
  }
  row.push(cell); rows.push(row);
  return rows;
}

test('normalizes numeric values while preserving an actual zero', () => {
  const record = selectionRecord(parcel({ area_terre: '2400.5', area_ter_1: '', area_const: 0, frente: undefined }), savedAt);
  assert.equal(record.area_terre, 2400.5);
  assert.equal(record.area_ter_1, null);
  assert.equal(record.area_const, 0);
  assert.equal(record.frente, null);
  assert.equal(record.clave_cata, '0012345678');
});

test('missing or malformed measurements are not manufactured as zero', () => {
  for (const value of [null, undefined, '', '   ', false, true, [], [5], {}, 'sin datos', NaN, Infinity, -1]) {
    const record = selectionRecord(parcel({ area_terre: value, area_ter_1: value, area_const: value, frente: value }), savedAt);
    for (const field of ['area_terre', 'area_ter_1', 'area_const', 'frente']) {
      assert.equal(record[field], null, `${field} must be missing for ${String(value)} (${typeof value})`);
    }
  }
});

test('keeps PH parent-lot and attributed-unit areas distinct without a fallback', () => {
  const record = selectionRecord(parcel(), savedAt);
  assert.equal(record.area_terre, 2400);
  assert.equal(record.area_ter_1, 120);
  const missingUnitArea = selectionRecord(parcel({ area_ter_1: null }), savedAt);
  assert.equal(missingUnitArea.area_terre, 2400);
  assert.equal(missingUnitArea.area_ter_1, null);
});

test('rejects invalid identifiers and retains only public comparison attributes', () => {
  for (const value of [null, {}, { n_predio: 'abc' }, { n_predio: '../123' }, { n_predio: '1'.repeat(26) }]) {
    assert.equal(selectionRecord(value), null);
  }
  const record = selectionRecord(parcel({ owner: 'Private name', identity_document: 'private', pdf: 'private', arbitrary: 'unexpected' }), savedAt);
  assert.deepEqual(Object.keys(record).sort(), [
    'n_predio', 'clave_cata', 'parroquia', 'tipo_propi', 'zonificaci',
    'area_terre', 'area_ter_1', 'area_const', 'frente', 'savedAt',
  ].sort());
});

test('malformed browser storage safely produces an empty selection', () => {
  for (const raw of [undefined, null, '', '{', 'null', '{}', '"text"', '42', 'true']) {
    assert.deepEqual(parseSelection(raw), []);
  }
});

test('restoration discards invalid records, de-duplicates IDs and enforces the selection limit', () => {
  const raw = JSON.stringify([
    parcel({ n_predio: '1', parroquia: 'First record', savedAt }),
    null,
    { n_predio: 'not-a-predio' },
    parcel({ n_predio: '1', parroquia: 'Duplicate record', savedAt }),
    ...[2, 3, 4, 5, 6].map(id => parcel({ n_predio: String(id), savedAt })),
  ]);
  const records = parseSelection(raw);
  assert.equal(records.length, SELECTION_LIMIT);
  assert.deepEqual(records.map(p => p.n_predio), ['1', '2', '3', '4']);
  assert.equal(records[0].parroquia, 'First record');
});

test('restoration handles invalid dates without retaining an invalid saved timestamp', () => {
  const [record] = parseSelection(JSON.stringify([parcel({ savedAt: 'not-a-date' })]));
  assert.equal(typeof record.savedAt, 'string');
  assert.ok(Number.isFinite(Date.parse(record.savedAt)));
});

test('CSV preserves missing versus zero and maps each source attribute to the correct column', () => {
  const [headers, row] = readCSV(selectionCSV([selectionRecord(parcel({ area_ter_1: null, frente: null }), savedAt)]));
  assert.equal(headers.length, 11);
  assert.equal(row.length, headers.length);
  assert.match(headers[5], /lote.*matriz/i);
  assert.match(headers[6], /atribuida.*PH/i);
  assert.deepEqual(row.slice(0, 10), ['627739', '0012345678', 'CUMBAYÁ', 'PROPIEDAD HORIZONTAL', 'URBANO', '2400', '', '0', '', savedAt]);
  assert.equal(row[10], 'Catastro municipal de Quito, atributos 2024');
});

test('CSV does not imply an attributed PH area for an ordinary parcel', () => {
  const [, row] = readCSV(selectionCSV([selectionRecord(parcel({ tipo_propi: 'UNIPROPIEDAD', area_ter_1: 120 }), savedAt)]));
  assert.equal(row[5], '2400');
  assert.equal(row[6], '');
});

test('CSV keeps commas, quotation marks, accents and embedded line breaks in one cell', () => {
  const text = 'Cumbayá, sector "La Primavera"\nReferencia';
  const csv = selectionCSV([selectionRecord(parcel({ parroquia: text }), savedAt)]);
  assert.ok(csv.startsWith('\uFEFF'));
  const rows = readCSV(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, 11);
  assert.equal(rows[1][2], text);
});

test('spreadsheet formula prefixes are exported as literal text', () => {
  for (const value of ['=1+1', '+SUM(1,2)', '-1+1', '@SUM(1)', '\t=1+1', '\r=1+1', '\n=1+1']) {
    const [, row] = readCSV(selectionCSV([selectionRecord(parcel({ parroquia: value }), savedAt)]));
    assert.equal(row[2], "'" + value, `Unsafe formula prefix: ${JSON.stringify(value)}`);
  }
});

test('empty CSV export remains a valid header-only file', () => {
  const rows = readCSV(selectionCSV([]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 11);
});
