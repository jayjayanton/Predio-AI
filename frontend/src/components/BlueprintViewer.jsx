import React, { useMemo, useRef, useState } from 'react';

/**
 * Source-linked vector geometry viewer. Coordinates are not calibrated.
 * Interaction never implies verified distances, wall classification, or area.
 */
export default function BlueprintViewer({ views = [] }) {
  const [page, setPage] = useState(views[0]?.page || 1);
  const [selected, setSelected] = useState([]);
  const [multiple, setMultiple] = useState(true);
  const [hiddenLayers, setHiddenLayers] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState([0, 0]);
  const [expanded, setExpanded] = useState(false);
  const drag = useRef(null);
  const view = views.find(v => v.page === page) || views[0];
  const bounds = view?.bounds;
  const elements = view?.elements || [];
  const layers = useMemo(() => [...new Set(elements.map(e => e.layer || 'Sin capa'))], [elements]);
  const visible = elements.filter(e => !hiddenLayers.includes(e.layer || 'Sin capa'));
  const active = visible.filter(e => selected.includes(e.id));
  const choose = (id) => setSelected(current => multiple
    ? current.includes(id) ? current.filter(v => v !== id) : [...current, id]
    : [id]);
  const reset = () => { setZoom(1); setOffset([0, 0]); };
  const scale = (factor) => setZoom(current => Math.min(16, Math.max(1, current * factor)));
  const width = bounds ? Math.max(1, bounds[2] - bounds[0]) : 1;
  const height = bounds ? Math.max(1, bounds[3] - bounds[1]) : 1;
  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const x = bounds ? bounds[0] + (width - viewWidth) / 2 + offset[0] : 0;
  const y = bounds ? bounds[1] + (height - viewHeight) / 2 + offset[1] : 0;

  return (
    <div className={expanded ? 'blueprint-viewer blueprint-expanded' : 'blueprint-viewer'}>
      <div className="blueprint-toolbar">
        <strong>Visor vectorial · sin escala verificada</strong>
        <div className="blueprint-tools">
          <button type="button" onClick={() => scale(1.5)} aria-label="Acercar">＋</button>
          <button type="button" onClick={() => scale(1 / 1.5)} aria-label="Alejar">−</button>
          <button type="button" onClick={reset}>Restablecer</button>
          <button type="button" onClick={() => setExpanded(v => !v)}>{expanded ? 'Cerrar pantalla completa' : 'Ampliar visor'}</button>
        </div>
      </div>
      <div className="blueprint-content">
        <div className="blueprint-canvas">
          {views.length > 1 && <label>Página <select value={page} onChange={e => {
            setPage(Number(e.target.value)); setSelected([]); setHiddenLayers([]); reset();
          }}>{views.map(v => <option key={v.page} value={v.page}>{v.page}</option>)}</select></label>}
          {bounds && visible.length > 0 ? (
            <svg viewBox={`${x} ${y} ${viewWidth} ${viewHeight}`}
              preserveAspectRatio="xMidYMid meet"
              className="blueprint-svg"
              aria-label="Geometría vectorial extraída del plano"
              onWheel={event => { event.preventDefault(); scale(event.deltaY < 0 ? 1.15 : 1 / 1.15); }}
              onPointerDown={event => { if (event.target === event.currentTarget) {
                drag.current = { px: event.clientX, py: event.clientY, ox: offset[0], oy: offset[1] };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}}
              onPointerMove={event => { if (drag.current) {
                const rect = event.currentTarget.getBoundingClientRect();
                setOffset([drag.current.ox - (event.clientX - drag.current.px) * viewWidth / rect.width,
                  drag.current.oy - (event.clientY - drag.current.py) * viewHeight / rect.height]);
              }}}
              onPointerUp={() => { drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }}
            >
              <rect x={x} y={y} width={viewWidth} height={viewHeight} fill="#fff" pointerEvents="none" />
              {visible.map(el => <polyline key={el.id}
                points={el.points.map(p => p.join(',')).join(' ')}
                fill="none" stroke={selected.includes(el.id) ? '#e65b25' : '#263747'}
                strokeWidth={selected.includes(el.id) ? 2.5 : 1}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onClick={() => choose(el.id)}>
                <title>{el.id}{el.layer ? ` · Capa ${el.layer}` : ''}</title>
              </polyline>)}
            </svg>
          ) : <div className="empty">No hay geometría vectorial visible. Active una capa o pruebe otro plano; los escaneos requieren procesamiento adicional.</div>}
          <p className="note">Use los controles para acercar; arrastre el fondo para desplazar. Las unidades y dimensiones no están verificadas.</p>
        </div>
        <aside className="blueprint-inspector">
          <h3>Capas ({layers.length})</h3>
          {layers.map(layer => <label key={layer} className="layer-choice"><input type="checkbox"
            checked={!hiddenLayers.includes(layer)}
            onChange={event => setHiddenLayers(old => event.target.checked ? old.filter(v => v !== layer) : [...old, layer])} /> {layer}</label>)}
          <hr />
          <label className="layer-choice"><input type="checkbox" checked={multiple}
            onChange={event => { setMultiple(event.target.checked); setSelected([]); }} /> Selección múltiple</label>
          <h3>Selección: {active.length}</h3>
          <button type="button" onClick={() => setSelected([])}>Limpiar selección</button>
          <ul>{active.slice(0, 30).map(el => <li key={el.id}>{el.id}{el.layer ? ` · ${el.layer}` : ''} · Sin medidas verificadas</li>)}</ul>
          <p className="note">No se han detectado automáticamente muros o habitaciones. Edición, mediciones y exportación de informes: pendientes.</p>
        </aside>
      </div>
    </div>
  );
}
