import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ProductOverview.jsx', import.meta.url), 'utf8');

// Content regressions, not browser, measurement or municipal-availability tests.
test('primary audiences are households, small practices and remodeling teams', () => {
  const start = source.indexOf('className="po-audience-grid po-core-audiences"');
  const end = source.indexOf('<details className="po-secondary-audiences"', start);
  assert.ok(start >= 0 && end > start);
  const primary = source.slice(start, end);
  for (const label of ['Propietarios y hogares', 'Arquitectos independientes y estudios pequeños', 'Empresas de remodelación y construcción']) assert.ok(primary.includes(label));
  assert.ok(!primary.includes('Inmobiliarias y desarrolladores'));
  assert.ok(!primary.includes('Seguros y peritajes'));
});

test('plan guidance remains user-led and does not promise automatic CAD retrieval', () => {
  assert.ok(source.includes('¿Todavía no tienes tus planos?'));
  assert.ok(source.includes('FrmFichaTramite?codtt=240'));
  assert.ok(source.includes('PredioAI no la presenta por ti'));
  assert.ok(source.includes('no se garantiza un CAD original'));
  assert.ok(source.includes('no necesariamente el estado actual de la casa'));
  assert.ok(source.includes('No cargues aquí cédulas, contraseñas'));
});
