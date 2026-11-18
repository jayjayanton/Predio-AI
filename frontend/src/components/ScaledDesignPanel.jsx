import React, {useEffect, useId, useState} from 'react';
import {normalizeRotation, parseDimension, planningShapeMetrics, PLANNING_LIMITS} from '../scaledPlanning.js';

const format = n => Number.isFinite(n) ? n.toLocaleString('es-EC', {maximumFractionDigits: 2}) : '—';
const dimensionLabel = shape => shape.kind === 'circle' ? `Ø ${format(shape.widthMetres)} m`
  : shape.kind === 'polygon' ? `${shape.verticesMetres.length} puntos · ${format(planningShapeMetrics(shape)?.areaM2)} m²`
    : `${format(shape.widthMetres)} × ${format(shape.depthMetres)} m`;
const DRAWING_TOOLS = [
  {kind: 'polygon', label: 'Polígono libre', hint: 'Punto a punto'},
  {kind: 'rectangle', label: 'Rectángulo', hint: 'Haz clic y arrastra'},
  {kind: 'square', label: 'Cuadrado', hint: 'Lados iguales'},
  {kind: 'triangle', label: 'Triángulo', hint: 'Marca 3 puntos'},
  {kind: 'circle', label: 'Círculo', hint: 'Dibuja su tamaño'},
];
function DrawingIcon({kind}) {
  return <svg viewBox="0 0 28 28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
    {kind === 'circle' ? <circle cx="14" cy="14" r="9" />
      : kind === 'rectangle' ? <rect x="3" y="7" width="22" height="14" rx="1" />
        : kind === 'square' ? <rect x="5" y="5" width="18" height="18" rx="1" />
          : kind === 'triangle' ? <path d="M14 4 25 24H3Z" />
            : <><path d="M5 5H22V13H15V23H5Z" /><path d="M3 3H7V7H3ZM20 3H24V7H20ZM20 11H24V15H20ZM13 11H17V15H13ZM13 21H17V25H13ZM3 21H7V25H3Z" fill="currentColor" stroke="none" /></>}
  </svg>;
}

export default function ScaledDesignPanel({shapes, selectedId, scale, showShapes, onShowShapes, onSelect, onUpdate,
  onDuplicate, onDelete, onMove, onReturn, onConfirmScale, onAdd, history, onUndo, onRedo,
  drawingTool = null, onStartDrawing, drawingPointsCount = 0, onFinishDrawing, onUndoPoint, onCancelDrawing,
  drawingRole = 'furniture', onDrawingRoleChange, draftMetrics = null, draftError = '',
  editMode = 'vertices', onEditModeChange, selectedVertex = null, onSelectVertex, onInsertVertex, onRemoveVertex}) {
  const selected = shapes.find(shape => shape.id === selectedId);
  const id = useId();
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const activeTool = DRAWING_TOOLS.find(item => drawingTool === `draw-${item.kind}`);
  const isDrawing = Boolean(activeTool);
  const drawingByPoints = activeTool?.kind === 'polygon' || activeTool?.kind === 'triangle';
  const polygon = selected?.kind === 'polygon';
  const vertices = polygon ? selected.verticesMetres : [];
  const hasSelectedVertex = Number.isInteger(selectedVertex) && selectedVertex >= 0 && selectedVertex < vertices.length;
  const maxVertices = PLANNING_LIMITS.maxVertices ?? PLANNING_LIMITS.maxPolygonVertices ?? 128;
  const selectedMetrics = selected ? planningShapeMetrics(selected) : null;
  const canCreate = Boolean(scale) && shapes.length < PLANNING_LIMITS.maxShapes;
  useEffect(() => {
    setFields(selected ? {label: selected.label, width: String(selected.widthMetres), depth: String(selected.depthMetres), rotation: String(selected.rotationDegrees), role: selected.role} : {});
    setError('');
  }, [selected]);
  const update = (name, value) => { setFields(current => ({...current, [name]: value})); setError(''); };
  const submit = event => {
    event.preventDefault(); if (!selected || !scale) return;
    const width = parseDimension(fields.width), depth = selected.kind === 'circle' ? width : parseDimension(fields.depth);
    const rotation = /^-?\d+(?:[.,]\d+)?$/.test(String(fields.rotation).trim()) ? Number(String(fields.rotation).replace(',', '.')) : NaN;
    if (width === null || depth === null) { setError('Introduce medidas entre 0,01 y 200 metros. Puedes usar coma decimal.'); return; }
    if (!Number.isFinite(rotation) || Math.abs(rotation) > 36000) { setError('Introduce un ángulo válido en grados.'); return; }
    if (!fields.label?.trim()) { setError('Dale un nombre a la figura.'); return; }
    onUpdate(selected.id, {label: fields.label.trim().slice(0, 60), widthMetres: width, depthMetres: depth,
      rotationDegrees: normalizeRotation(rotation), role: fields.role});
    setError('');
  };
  return <section className="cad-design-panel" aria-label="Figuras a escala">
    <div className="cad-studio-panel-heading"><div><span className="cad-studio-eyebrow">DISEÑA SOBRE TU PLANO</span><h3>Figuras a escala</h3></div><span className="cad-studio-count">{shapes.length}/{PLANNING_LIMITS.maxShapes}</span></div>
    <p className="cad-studio-description">Dibuja tus propios contornos. Arrastra sus esquinas para ampliar, reducir o cambiar la forma, siempre a la escala del plano.</p>
    {!scale && <div className="cad-design-empty"><strong>Primero, confirma la escala.</strong><p>Una figura de 1 metro necesita la unidad o una longitud de referencia del dibujo.</p><button type="button" onClick={onConfirmScale}>Confirmar escala en Medidas</button></div>}
    <div className="cad-sketch-tools" aria-label="Dibujar sobre el plano">
      <h4>Dibujar sobre el plano</h4>
      <label className="cad-studio-field" htmlFor={`${id}-drawing-role`}>Uso del nuevo dibujo<select id={`${id}-drawing-role`} value={drawingRole} disabled={!scale || !onDrawingRoleChange || isDrawing} onChange={event => onDrawingRoleChange?.(event.target.value)}><option value="furniture">Mobiliario o referencia</option><option value="extension">Ampliación propuesta</option></select></label>
      <div className="cad-sketch-tool-grid">{DRAWING_TOOLS.map(item => <button type="button" key={item.kind}
        className={`${item.kind === 'polygon' ? 'cad-sketch-free' : ''}${drawingTool === `draw-${item.kind}` ? ' is-active' : ''}`}
        aria-label={`Dibujar ${item.label.toLocaleLowerCase('es')}`} aria-pressed={drawingTool === `draw-${item.kind}`}
        disabled={!canCreate || !onStartDrawing} onClick={() => onStartDrawing?.(item.kind)}>
        <DrawingIcon kind={item.kind} /><span>{item.label}<small>{item.hint}</small></span>
      </button>)}</div>
      {!isDrawing && <p className="cad-sketch-guidance">El tamaño lo decides sobre el dibujo. Después puedes ajustarlo arrastrando los puntos o introduciendo medidas.</p>}
    </div>
    {isDrawing && <div className="cad-sketch-progress" role="status">
      <div className="cad-sketch-progress-heading"><strong>{activeTool.label}</strong><span>{drawingByPoints ? `${drawingPointsCount}${activeTool.kind === 'triangle' ? ' / 3' : ''} puntos` : 'Arrastra en el plano'}</span></div>
      <p>{drawingByPoints
        ? activeTool.kind === 'triangle' ? 'Marca las tres esquinas en el plano. El tercer punto completa el triángulo.' : 'Marca cada esquina. Cierra en el primer punto o pulsa «Cerrar polígono».'
        : activeTool.kind === 'circle' ? 'Haz clic y arrastra para definir el diámetro. Suelta para crear el círculo.' : 'Haz clic en una esquina y arrastra hasta la opuesta. Suelta para crear la figura.'}</p>
      {draftMetrics && <dl className="cad-sketch-metrics" aria-label="Medidas del dibujo en curso">
        {Number.isFinite(draftMetrics.widthMetres) && <div><dt>Ancho</dt><dd>{format(draftMetrics.widthMetres)} <small>m</small></dd></div>}
        {Number.isFinite(draftMetrics.depthMetres) && <div><dt>Fondo</dt><dd>{format(draftMetrics.depthMetres)} <small>m</small></dd></div>}
        {Number.isFinite(draftMetrics.areaM2) && <div><dt>Área del borrador</dt><dd>{format(draftMetrics.areaM2)} <small>m²</small></dd></div>}
        {Number.isFinite(draftMetrics.perimeterM) && <div><dt>Perímetro</dt><dd>{format(draftMetrics.perimeterM)} <small>m</small></dd></div>}
      </dl>}
      {drawingByPoints && <button type="button" className="cad-studio-primary" disabled={!onFinishDrawing || drawingPointsCount < 3 || (activeTool.kind === 'triangle' && drawingPointsCount !== 3)} onClick={onFinishDrawing}>{activeTool.kind === 'triangle' ? 'Terminar triángulo' : 'Cerrar polígono'}</button>}
      <div className="cad-sketch-draft-actions">{drawingByPoints && <button type="button" disabled={!drawingPointsCount || !onUndoPoint} onClick={onUndoPoint}>Deshacer punto</button>}<button type="button" onClick={onCancelDrawing} disabled={!onCancelDrawing}>Cancelar dibujo</button></div>
      <small>{drawingByPoints ? 'Enter: terminar · Esc: cancelar' : 'Esc: cancelar'}</small>
    </div>}
    {draftError && <p className="cad-design-error" role="alert">{draftError}</p>}
    <details className="cad-design-shortcuts"><summary>Atajos de mobiliario</summary><p>Empieza con una medida sugerida y cambia su forma o tamaño.</p><div className="cad-design-presets">
      <button type="button" disabled={!canCreate || isDrawing} onClick={() => onAdd('table')}><span aria-hidden="true">▭</span>Mesa <small>1,60 × 0,90 m</small></button>
      <button type="button" disabled={!canCreate || isDrawing} onClick={() => onAdd('circle')}><span aria-hidden="true">○</span>Círculo <small>Ø 1,00 m</small></button>
      <button type="button" className="cad-extension-preset" disabled={!canCreate || isDrawing} onClick={() => onAdd('extension')}><span aria-hidden="true">▱</span>Ampliación <small>3,00 × 4,00 m</small></button>
    </div></details>
    <div className="cad-design-history"><button type="button" onClick={onUndo} disabled={!history.past.length || isDrawing}>↶ Deshacer</button><button type="button" onClick={onRedo} disabled={!history.future.length || isDrawing}>↷ Rehacer</button></div>
    {shapes.length > 0 && <>
      <label className="cad-inline-check cad-design-visibility"><input type="checkbox" checked={showShapes} disabled={isDrawing} onChange={event => onShowShapes(event.target.checked)} /> Mostrar figuras en el plano</label>
      {!showShapes && <p className="cad-studio-description">Ocultas solo en el visor; las ampliaciones siguen incluidas en el escenario.</p>}
      <label className="cad-studio-field">Figura activa<select aria-label="Figura activa" disabled={isDrawing} value={selected?.id || ''} onChange={event => onSelect(event.target.value)}><option value="">Selecciona una figura…</option>{shapes.map(shape => <option key={shape.id} value={shape.id}>{shape.label} · {dimensionLabel(shape)}</option>)}</select></label>
    </>}
    {selected && !isDrawing && <>
      {selectedMetrics && <dl className="cad-sketch-metrics cad-shape-metrics" aria-label="Medidas de la figura"><div><dt>Área de la figura</dt><dd>{format(selectedMetrics.areaM2)} <small>m²</small></dd></div><div><dt>Perímetro</dt><dd>{format(selectedMetrics.perimeterM)} <small>m</small></dd></div></dl>}
      {polygon && <div className="cad-vertex-editor">
        <div className="cad-shape-edit-modes" role="group" aria-label="Editar la forma del polígono"><button type="button" aria-pressed={editMode === 'vertices'} disabled={!scale || !onEditModeChange} onClick={() => onEditModeChange?.('vertices')}>Editar vértices</button><button type="button" aria-pressed={editMode === 'resize'} disabled={!scale || !onEditModeChange} onClick={() => onEditModeChange?.('resize')}>Cambiar tamaño</button></div>
        <p>{editMode === 'resize' ? 'Arrastra las esquinas del marco para ampliar o reducir el polígono completo.' : 'Arrastra un punto para cambiar el contorno. Los puntos intermedios de cada lado permiten añadir una esquina.'}</p>
        {editMode === 'vertices' && <><label className="cad-studio-field">Punto del polígono<select aria-label="Punto del polígono" value={hasSelectedVertex ? String(selectedVertex) : ''} onChange={event => onSelectVertex?.(event.target.value === '' ? null : Number(event.target.value))} disabled={!scale || !onSelectVertex}><option value="">Selecciona un punto…</option>{vertices.map((_, index) => <option value={index} key={index}>Punto {index + 1}</option>)}</select></label>
          <div className="cad-vertex-actions"><button type="button" disabled={!scale || !hasSelectedVertex || vertices.length >= maxVertices || !onInsertVertex} onClick={() => onInsertVertex?.(selectedVertex)}>Añadir punto después</button><button type="button" disabled={!scale || !hasSelectedVertex || vertices.length <= 3 || !onRemoveVertex} onClick={() => onRemoveVertex?.(selectedVertex)}>Eliminar punto</button></div>
          <small>{hasSelectedVertex ? `Punto ${selectedVertex + 1} seleccionado. El punto nuevo se añade a mitad del lado siguiente.` : 'Selecciona un punto aquí o en el plano para editarlo.'} {vertices.length} de {maxVertices} puntos.{vertices.length === 3 ? ' Un polígono necesita al menos 3 puntos.' : ''}</small>
          <small className="cad-vertex-keyboard">Con un punto seleccionado en el plano: flechas para moverlo 5 cm, Mayús + flechas para 50 cm y Supr para eliminarlo. Esc cancela el ajuste en curso.</small>
        </>}
      </div>}
      <form className="cad-shape-editor" onSubmit={submit}>
        <div className="cad-shape-editor-heading"><strong>{selected.kind === 'circle' ? 'Círculo' : polygon ? (vertices.length === 3 ? 'Triángulo' : 'Polígono libre') : Math.abs(selected.widthMetres - selected.depthMetres) < 1e-8 ? 'Cuadrado' : 'Rectángulo'}</strong><span className={selected.role === 'extension' ? 'is-extension' : ''}>{selected.role === 'extension' ? 'Ampliación propuesta' : 'Mobiliario / referencia'}</span></div>
        <label className="cad-studio-field" htmlFor={`${id}-name`}>Nombre<input id={`${id}-name`} type="text" maxLength={60} value={fields.label || ''} onChange={event => update('label', event.target.value)} /></label>
        <div className="cad-design-dimensions">
          <label className="cad-studio-field" htmlFor={`${id}-width`}>{selected.kind === 'circle' ? 'Diámetro (m)' : 'Ancho (m)'}<input id={`${id}-width`} inputMode="decimal" type="text" value={fields.width || ''} onChange={event => update('width', event.target.value)} /></label>
          {selected.kind !== 'circle' && <label className="cad-studio-field" htmlFor={`${id}-depth`}>Fondo (m)<input id={`${id}-depth`} inputMode="decimal" type="text" value={fields.depth || ''} onChange={event => update('depth', event.target.value)} /></label>}
        </div>
        {polygon && <p className="cad-shape-size-note">Ancho y fondo corresponden al marco de la figura antes del giro. Cambiarlos ajusta todos sus puntos.</p>}
        <label className="cad-studio-field" htmlFor={`${id}-role`}>Uso en el escenario<select id={`${id}-role`} value={fields.role || 'furniture'} onChange={event => update('role', event.target.value)}><option value="furniture">Mobiliario o referencia</option><option value="extension">Ampliación propuesta</option></select></label>
        {selected.kind !== 'circle' && <label className="cad-studio-field" htmlFor={`${id}-rotation`}>Rotación (°)<input id={`${id}-rotation`} type="text" inputMode="decimal" value={fields.rotation ?? '0'} onChange={event => update('rotation', event.target.value)} /></label>}
        {error && <p className="cad-design-error" role="alert">{error}</p>}
        <button className="cad-studio-primary" type="submit" disabled={!scale}>Aplicar medidas</button>
        <div className="cad-design-actions"><button type="button" disabled={!canCreate} onClick={() => onDuplicate(selected.id)}>Duplicar</button><button type="button" className="cad-studio-delete" onClick={() => onDelete(selected.id)}>Eliminar figura</button></div>
      </form>
      {scale && <div className="cad-shape-position"><span>Ajuste fino de la figura · 10 cm</span><div className="cad-shape-nudge"><button type="button" aria-label="Mover figura a la izquierda 10 centímetros" onClick={() => onMove(-0.1, 0)}>←</button><button type="button" aria-label="Mover figura arriba 10 centímetros" onClick={() => onMove(0, -0.1)}>↑</button><button type="button" aria-label="Mover figura abajo 10 centímetros" onClick={() => onMove(0, 0.1)}>↓</button><button type="button" aria-label="Mover figura a la derecha 10 centímetros" onClick={() => onMove(0.1, 0)}>→</button></div><button type="button" onClick={onReturn}>Colocar en el plano</button></div>}
    </>}
    {shapes.length === 0 && scale && !isDrawing && <p className="cad-design-empty">Elige una herramienta y dibuja directamente sobre el plano. La forma y el tamaño los defines tú.</p>}
    <p className="cad-studio-footnote">Las figuras son propuestas editables. El archivo CAD original conserva su geometría. Solo las figuras marcadas como ampliación participan en la ocupación del escenario.</p>
  </section>;
}

const FOOTPRINT_REASONS = {
  scale_required: 'Confirma la escala en Medidas antes de extraer una huella.',
  multiple_contours: 'Selecciona un contorno exterior único; la selección contiene contornos separados.',
  nested_islands: 'La selección contiene islas anidadas. Usa un polígono de planta más sencillo.',
  overlapping_rings: 'Los anillos se cruzan o superponen. Elige una frontera sin ambigüedades.',
  self_intersection: 'Este contorno se cruza a sí mismo. Revisa otra frontera del dibujo.',
  open_path: 'El trazado está abierto. Selecciona una polilínea o trama con contorno cerrado.',
  size_range: 'La dimensión supera 5 km. Revisa la escala antes de usar este contorno.',
  complexity_limit: 'El contorno tiene demasiados segmentos para esta revisión. Elige una frontera más sencilla.',
};
export function GroundFootprintPanel({choice, selectedElement, footprint, scale, onUse, onClear, onChoose, onConfirmScale}) {
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [selectedElement, scale]);
  return <section className="cad-footprint-panel" aria-label="Extraer huella de planta">
    <div className="cad-studio-panel-heading"><div><span className="cad-studio-eyebrow">DEL PLANO AL TERRENO</span><h3>Huella de planta</h3></div><span aria-hidden="true" className="cad-footprint-icon">⌑</span></div>
    <p className="cad-studio-description">Elige el polígono que representa la planta baja para probar su implantación sobre un predio.</p>
    <ol className="cad-footprint-steps"><li>Confirma la escala del dibujo.</li><li>Selecciona un contorno cerrado del CAD.</li><li>Declara su uso como huella y extráelo.</li></ol>
    {!scale && <button type="button" onClick={onConfirmScale}>Confirmar escala en Medidas</button>}
    <button type="button" onClick={onChoose}>Elegir contorno en el plano</button>
    {selectedElement && <div className="cad-footprint-candidate"><span>Contorno seleccionado</span><strong>{selectedElement.source_handle || selectedElement.source_id || selectedElement.id}</strong><small>{selectedElement.layer}</small></div>}
    {!choice?.ok && <p className="cad-studio-description">{FOOTPRINT_REASONS[choice?.reason] || 'Selecciona un único contorno cerrado y visible. Un texto, una cota o varias líneas sueltas no definen una huella.'}</p>}
    {choice?.ok && <div className="cad-footprint-choice"><div className="cad-footprint-area"><span>Área del polígono</span><strong>{format(choice.areaM2)} <small>m²</small></strong></div><p>{choice.holes ? `${choice.holes} hueco(s) interior(es) conservado(s) y descontado(s).` : 'Un contorno exterior sin huecos interiores.'}{choice.approximate ? ' Incluye curvas aproximadas del archivo.' : ''}</p>
      <label className="cad-footprint-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Este contorno representa la huella de la planta baja que quiero analizar.</span></label>
      <button type="button" className="cad-studio-primary" disabled={!confirmed} onClick={() => {onUse(choice); setConfirmed(false);}}>Usar como huella</button>
    </div>}
    {footprint && <div className="cad-footprint-active" role="status"><span>Huella extraída</span><strong>{format(footprint.areaM2)} m²</strong><p>Contorno azul · {footprint.holes} hueco(s). Lista para el panel de implantación, debajo del visor.</p><button type="button" onClick={onClear}>Quitar huella</button></div>}
    <p className="cad-studio-footnote">La selección no identifica automáticamente el edificio. La huella conserva coordenadas locales; su ubicación en el predio se revisa por separado.</p>
  </section>;
}
