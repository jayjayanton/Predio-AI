import React from 'react';
import { SELECTION_LIMIT, selectionCSV } from '../selection.js';

const number = (value, suffix = '') => value == null || !Number.isFinite(Number(value)) ? 'No disponible' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 }) + suffix;
const isPH = p => p.tipo_propi.trim().toUpperCase() === 'PROPIEDAD HORIZONTAL';

export default function SelectionPage({ records, onExplore, onOpen, onRemove, loading, error, storageAvailable }) {
  function exportCSV() {
    const url = URL.createObjectURL(new Blob([selectionCSV(records)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'PredioAI-seleccion.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const rows = [
    ['Parroquia', p => p.parroquia || 'No disponible'],
    ['Régimen de propiedad', p => p.tipo_propi || 'No disponible'],
    ['Superficie del lote / lote matriz', p => number(p.area_terre, ' m²')],
    ['Terreno atribuido a unidad PH', p => isPH(p) ? number(p.area_ter_1, ' m²') : 'No aplica'],
    ['Construcción registrada', p => number(p.area_const, ' m²')],
    ['Frente registrado', p => number(p.frente, ' m')],
    ['Clasificación catastral del suelo', p => p.zonificaci || 'No disponible'],
    ['Clave catastral', p => p.clave_cata || 'No disponible'],
  ];
  return <section className="portfolio-page" aria-labelledby="selection-title">
    <div className="workspace-heading">
      <div><span className="eyebrow">TU MESA DE TRABAJO</span><h1 id="selection-title">Una selección. Una visión más clara.</h1><p>Compara hasta {SELECTION_LIMIT} predios con los mismos criterios antes de profundizar en su evaluación.</p></div>
      <button className="secondary" onClick={onExplore}>Volver al explorador ↗</button>
    </div>
    <div className="selection-toolbar"><span>{records.length} de {SELECTION_LIMIT} predios · {storageAvailable ? 'Guardados en este navegador' : 'Solo durante esta sesión'}</span>{records.length > 0 && <button type="button" className="secondary" onClick={exportCSV}>Descargar comparación CSV ↓</button>}</div>
    {error && <p className="error" role="alert">{error}</p>}
    {!records.length ? <div className="explorer-empty selection-empty"><span className="empty-map-symbol" aria-hidden="true">▧</span><h2>Tu selección empieza en el mapa.</h2><p>Busca un terreno, selecciona su tarjeta y pulsa «Guardar en selección». Aquí podrás comparar sus características.</p><button className="primary-action" onClick={onExplore}>Explorar predios →</button></div>
      : <>
        <div className="comparison-scroll" tabIndex={0} role="region" aria-label="Comparación de predios; deslice horizontalmente para ver todos">
          <table className="comparison-table">
            <caption>Comparación catastral · Quito · Atributos 2024</caption>
            <thead><tr><th scope="col">Criterio</th>{records.map(p => <th key={p.n_predio} scope="col"><span>Predio</span><strong>{p.n_predio}</strong></th>)}</tr></thead>
            <tbody>{rows.map(([label, render]) => <tr key={label}><th scope="row">{label}</th>{records.map(p => <td key={p.n_predio}>{render(p)}</td>)}</tr>)}
              <tr><th scope="row">Siguiente paso</th>{records.map(p => <td key={p.n_predio}><button type="button" className="secondary" disabled={loading} onClick={() => onOpen(p.n_predio)} aria-label={`Abrir ficha del predio ${p.n_predio}`}>{loading ? 'Consultando…' : 'Abrir ficha →'}</button><button type="button" className="text-button" onClick={() => onRemove(p.n_predio)} aria-label={`Quitar predio ${p.n_predio} de la selección`}>Quitar de selección</button></td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="source-note">Fuente: catastro municipal de Quito, atributos 2024. Son instantáneas de tu consulta; abre la ficha para consultar nuevamente. En propiedad horizontal, el lote matriz y el terreno atribuido a la unidad se muestran por separado.</p>
        <p className="note">La selección es una comparación descriptiva. No confirma disponibilidad de venta, permisos constructivos ni valor de mercado. La priorización analítica se incorporará en la próxima etapa.</p>
      </>}
  </section>;
}
