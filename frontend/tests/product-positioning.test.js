import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const overview = readFileSync(new URL('../src/components/ProductOverview.jsx', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const methodology = readFileSync(new URL('../../docs/ARCHITECTURAL_ANALYSIS_METHODOLOGY.md', import.meta.url), 'utf8');

// Copy/positioning regression checks only. These do not validate measurements,
// rendering, live municipal services or the drawing inspection API.
test('the main homepage action starts a home project without removing discovery', () => {
  assert.match(overview, /className="po-button po-button-primary" onClick=\{onBlueprints\}>Iniciar mi proyecto/);
  for (const callback of ['onBlueprints', 'onConsult', 'onExplore', 'onAnalytics']) {
    assert.ok(overview.includes(`onClick={${callback}}`), `${callback} remains reachable`);
  }
});

test('everyday interventions and the original property-plan-IRM foundation stay visible', () => {
  for (const text of ['Entiende tu casa.', 'Pintar paredes y techos', 'Cambiar el piso', 'Reorganizar o reparar', 'Reconstruir o ampliar', 'PDF / DXF', 'IRM']) {
    assert.ok(overview.includes(text), `Missing product context: ${text}`);
  }
  assert.ok(!readme.includes('Territorial intelligence for real estate decisions'));
});

test('existing geometry inspection is distinct from planned measurement and insurance', () => {
  assert.match(overview, /Selección múltiple, capas y zoom, sin medidas verificadas/);
  assert.match(overview, /Posible extensión · no implementada/);
  assert.match(overview, /Un plano describe el diseño, no el daño ocurrido/);
  assert.match(overview, /Mediciones verificadas|mediciones verificadas/);
  assert.ok(!methodology.includes('The product is **not** an insurance-claims platform.'));
});

test('methodology preserves calculation and professional review boundaries', () => {
  for (const guardrail of ['automatic_costs=False', 'determine_safety=False', 'decide_coverage=False', 'calculate_indemnity=False', 'invalidate_dependent_results']) {
    assert.ok(methodology.includes(guardrail), `Missing boundary: ${guardrail}`);
  }
  assert.match(methodology, /not a claim that every proposed use is already built/);
});
