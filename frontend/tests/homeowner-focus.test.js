import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/components/ProductOverview.jsx', import.meta.url), 'utf8');
test('homeowners, small architects and remodeling crews are the primary audience', () => {
  const from=source.indexOf('className="po-audience-grid po-core-audiences"');
  const to=source.indexOf('<details className="po-secondary-audiences"',from);
  assert.ok(from>0 && to>from);
  const main=source.slice(from,to);
  for(const title of ['Propietarios y hogares','Arquitectos independientes y estudios pequeños','Empresas de remodelación y construcción']) assert.ok(main.includes(title));
  assert.ok(!main.includes('Seguros y peritajes'));
});
test('plan guidance is owner-led and makes no CAD download claim', () => {
  for (const phrase of ['¿Todavía no tienes tus planos?','FrmFichaTramite?codtt=240','PredioAI no la presenta por ti','no se garantiza un CAD original','No cargues aquí cédulas, contraseñas','no representan necesariamente el estado actual de la casa']) {
    assert.ok(source.includes(phrase),'Missing plan boundary: '+phrase);
  }
});
