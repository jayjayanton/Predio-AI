import React, { useState } from 'react';

/**
 * Selects source-linked drawing primitives, not automatically detected walls.
 * All coordinates are native PDF points or unverified DXF units.
 * No length/area values are produced here.
 */
export default function BlueprintViewer({ views = [] }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [multiple, setMultiple] = useState(true);
  const view = views.find(v => v.page === page) || views[0];
  const bounds = view?.bounds;
  const elements = view?.elements || [];
  const active = elements.filter(e => selected.includes(e.id));
  const choose = (id) => setSelected(current =>
    multiple
      ? current.includes(id) ? current.filter(v => v !== id) : [...current, id]
      : [id]
  );

  return (
    <div className="ph-details">
      <div className="section-heading">
        VISOR DE PLANOS <span>EXPERIMENTAL</span>
      </div>
      <p className="note">
        Seleccione una o varias líneas de la geometría extraída.
        Son entidades gráficas sin clasificar: no se han identificado
        muros, habitaciones ni cubiertas. No se calculan dimensiones
        reales sin escala y unidades verificadas.
      </p>
      {views.length > 1 && (
        <label>
          Página:
          <select value={page} onChange={event => {
            setPage(Number(event.target.value));
            setSelected([]);
          }}>
            {views.map(v => <option key={v.page} value={v.page}>{v.page}</option>)}
          </select>
        </label>
      )}
      <label style={{ display: 'block', margin: '10px 0' }}>
        <input type="checkbox" checked={multiple}
          onChange={event => { setMultiple(event.target.checked); setSelected([]); }} />
        {' '}Selección múltiple
      </label>
      {bounds && elements.length > 0 ? (
        <svg
          viewBox={`${bounds[0]} ${bounds[1]} ${bounds[2] - bounds[0]} ${bounds[3] - bounds[1]}`}
          style={{ display: 'block', width: '100%', maxHeight: 420,
            background: '#fff', border: '1px solid #aab2bd', borderRadius: 8 }}
          aria-label="Geometría vectorial extraída del plano"
        >
          {elements.map(el => (
            <polyline key={el.id}
              points={el.points.map(p => p.join(',')).join(' ')}
              fill="none"
              stroke={selected.includes(el.id) ? '#e65b25' : '#263747'}
              strokeWidth={selected.includes(el.id) ? 2.5 : 1}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={() => choose(el.id)}
            >
              <title>{el.id}{el.layer ? ` · Capa ${el.layer}` : ''}</title>
            </polyline>
          ))}
        </svg>
      ) : (
        <p className="note">
          No se encontraron líneas o polilíneas vectoriales compatibles
          en esta página. Los planos escaneados necesitan otro proceso.
        </p>
      )}
      <p className="note">
        {active.length} elemento(s) seleccionado(s).
        {' '}
        <button type="button" className="secondary"
          onClick={() => setSelected([])}>Limpiar selección</button>
      </p>
      {active.length > 0 && (
        <ul>
          {active.slice(0, 30).map(el => (
            <li key={el.id}>{el.id}{el.layer ? ` · ${el.layer}` : ''} · Sin medidas verificadas</li>
          ))}
        </ul>
      )}
      <p className="note">
        La selección es temporal. La edición, recalculación y generación
        de informes todavía no están implementadas.
      </p>
    </div>
  );
}
