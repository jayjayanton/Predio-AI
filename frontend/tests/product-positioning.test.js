import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const overview = readFileSync(new URL('../src/components/ProductOverview.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const methodology = readFileSync(new URL('../../docs/ARCHITECTURAL_ANALYSIS_METHODOLOGY.md', import.meta.url), 'utf8');

// Source-based copy/UX regressions, not e2e browser or geometry measurements.
test('the primary action enters the preserved plan workflow', () => {
  assert.match(overview, /className="po-button po-button-primary" onClick=\{onBlueprints\}>Iniciar mi proyecto/);
  for (const handler of ['onBlueprints','onConsult','onExplore','onAnalytics']) {
    assert.ok(overview.includes('onClick={' + handler + '}'), handler + ' remains reachable');
  }
  assert.match(app, /const ROUTES = \{[^}]+planos: 'blueprints'/);
  assert.match(app, /page === 'blueprints'/);
});
test('home explains the product and two unambiguous entry points', () => {
  for (const phrase of ['Entiende tus planos.', 'Prepara tu reforma.', 'Quiero revisar los planos de mi casa','Quiero conocer la información de mi propiedad','Una herramienta de análisis previo, no una empresa de reformas.']) {
    assert.ok(overview.includes(phrase), 'Missing explanation: ' + phrase);
  }
  assert.match(overview,/No contrata obreros, selecciona proveedores, administra una obra, calcula presupuestos finales ni realiza una reforma por ti/);
  assert.match(readme,/not a project-management platform/);
});
test('keep household use cases and distinguish geometric measurements from architectural validation', () => {
  for (const phrase of ['Pintar paredes y techos','Cambiar el piso','Hacer espacio para tus ideas','Estudiar una ampliación','PDF / CAD / ZIP','IRM']) {
    assert.ok(overview.includes(phrase), 'Missing use case: '+phrase);
  }
  assert.match(overview,/mediciones con escala confirmada/);
  assert.match(overview,/figuras con dimensiones reales/);
  assert.match(overview,/verificación arquitectónica y municipal requiere revisión profesional/);
  assert.match(overview,/Posible extensión · no implementada/);
  assert.match(overview,/Un plano describe el diseño, no el daño ocurrido/);
});
test('header prioritizes direct workflows; complementary analytics stays reachable', () => {
  assert.match(app,/\[\['home','Inicio'\],\['blueprints','Analizar planos'\],\['property','Mi predio'\],\['explore','Explorar mapa'\],\['selection','Selección'\]\]/);
  assert.match(overview,/Otras herramientas y posibilidades futuras/);
  assert.match(overview,/onClick=\{onAnalytics\}>Ver futura analítica/);
});
test('methodology still preserves human review and safe measurement boundaries', () => {
  for (const phrase of ['automatic_costs=False','determine_safety=False','decide_coverage=False','calculate_indemnity=False','invalidate_dependent_results']) {
    assert.ok(methodology.includes(phrase),'Missing methodology guardrail: '+phrase);
  }
});
