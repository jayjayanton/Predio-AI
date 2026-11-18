import React, {useEffect, useId, useState} from 'react';
import {normalizeRotation, parseDimension, PLANNING_LIMITS} from '../scaledPlanning.js';

const format = n => n.toLocaleString('es-EC', {maximumFractionDigits: 2});
const dimensionLabel = shape => shape.kind === 'circle' ? `Ø ${format(shape.widthMetres)} m` : `${format(shape.widthMetres)} × ${format(shape.depthMetres)} m`;

export default function ScaledDesignPanel({shapes, selectedId, scale, showShapes, onShowShapes, onSelect, onUpdate,
  onDuplicate, onDelete, onMove, onReturn, onConfirmScale, onAdd, history, onUndo, onRedo}) {
  const selected = shapes.find(shape => shape.id === selectedId);
  const id = useId();
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
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
    <p className="cad-studio-description">Prueba una mesa, una zona circular o una ampliación. Las medidas se mantienen al acercar el plano.</p>
    {!scale && <div className="cad-design-empty"><strong>Primero, confirma la escala.</strong><p>Una figura de 1 metro necesita la unidad o una longitud de referencia del dibujo.</p><button type="button" onClick={onConfirmScale}>Confirmar escala en Medidas</button></div>}
    <div className="cad-design-presets">
      <button type="button" disabled={!scale || shapes.length >= PLANNING_LIMITS.maxShapes} onClick={() => onAdd('table')}><span aria-hidden="true">▭</span>Mesa <small>1,60 × 0,90 m</small></button>
      <button type="button" disabled={!scale || shapes.length >= PLANNING_LIMITS.maxShapes} onClick={() => onAdd('circle')}><span aria-hidden="true">○</span>Círculo <small>Ø 1,00 m</small></button>
      <button type="button" className="cad-extension-preset" disabled={!scale || shapes.length >= PLANNING_LIMITS.maxShapes} onClick={() => onAdd('extension')}><span aria-hidden="true">▱</span>Ampliación <small>3,00 × 4,00 m</small></button>
    </div>
    <div className="cad-design-history"><button type="button" onClick={onUndo} disabled={!history.past.length}>↶ Deshacer</button><button type="button" onClick={onRedo} disabled={!history.future.length}>↷ Rehacer</button></div>
    {shapes.length > 0 && <>
      <label className="cad-inline-check cad-design-visibility"><input type="checkbox" checked={showShapes} onChange={event => onShowShapes(event.target.checked)} /> Mostrar figuras en el plano</label>
      {!showShapes && <p className="cad-studio-description">Ocultas solo en el visor; las ampliaciones siguen incluidas en el escenario.</p>}
      <label className="cad-studio-field">Figura activa<select aria-label="Figura activa" value={selected?.id || ''} onChange={event => onSelect(event.target.value)}><option value="">Selecciona una figura…</option>{shapes.map(shape => <option key={shape.id} value={shape.id}>{shape.label} · {dimensionLabel(shape)}</option>)}</select></label>
    </>}
    {selected && <form className="cad-shape-editor" onSubmit={submit}>
      <div className="cad-shape-editor-heading"><strong>{selected.kind === 'circle' ? 'Círculo' : 'Rectángulo'}</strong><span className={selected.role === 'extension' ? 'is-extension' : ''}>{selected.role === 'extension' ? 'Ampliación propuesta' : 'Mobiliario / referencia'}</span></div>
      <label className="cad-studio-field" htmlFor={`${id}-name`}>Nombre<input id={`${id}-name`} type="text" maxLength={60} value={fields.label || ''} onChange={event => update('label', event.target.value)} /></label>
      <div className="cad-design-dimensions">
        <label className="cad-studio-field" htmlFor={`${id}-width`}>{selected.kind === 'circle' ? 'Diámetro (m)' : 'Ancho (m)'}<input id={`${id}-width`} inputMode="decimal" type="text" value={fields.width || ''} onChange={event => update('width', event.target.value)} /></label>
        {selected.kind !== 'circle' && <label className="cad-studio-field" htmlFor={`${id}-depth`}>Fondo (m)<input id={`${id}-depth`} inputMode="decimal" type="text" value={fields.depth || ''} onChange={event => update('depth', event.target.value)} /></label>}
      </div>
      <label className="cad-studio-field" htmlFor={`${id}-role`}>Uso en el escenario<select id={`${id}-role`} value={fields.role || 'furniture'} onChange={event => update('role', event.target.value)}><option value="furniture">Mobiliario o referencia</option><option value="extension">Ampliación propuesta</option></select></label>
      {selected.kind !== 'circle' && <label className="cad-studio-field" htmlFor={`${id}-rotation`}>Rotación (°)<input id={`${id}-rotation`} type="text" inputMode="decimal" value={fields.rotation ?? '0'} onChange={event => update('rotation', event.target.value)} /></label>}
      {error && <p className="cad-design-error" role="alert">{error}</p>}
      <button className="cad-studio-primary" type="submit" disabled={!scale}>Aplicar medidas</button>
      <div className="cad-design-actions"><button type="button" disabled={!scale || shapes.length >= PLANNING_LIMITS.maxShapes} onClick={() => onDuplicate(selected.id)}>Duplicar</button><button type="button" className="cad-studio-delete" onClick={() => onDelete(selected.id)}>Eliminar figura</button></div>
    </form>}
    {selected && scale && <div className="cad-shape-position"><span>Ajuste fino · 10 cm</span><div className="cad-shape-nudge"><button type="button" aria-label="Mover figura a la izquierda 10 centímetros" onClick={() => onMove(-0.1, 0)}>←</button><button type="button" aria-label="Mover figura arriba 10 centímetros" onClick={() => onMove(0, -0.1)}>↑</button><button type="button" aria-label="Mover figura abajo 10 centímetros" onClick={() => onMove(0, 0.1)}>↓</button><button type="button" aria-label="Mover figura a la derecha 10 centímetros" onClick={() => onMove(0.1, 0)}>→</button></div><button type="button" onClick={onReturn}>Colocar en el plano</button></div>}
    {shapes.length === 0 && scale && <p className="cad-design-empty">Elige una figura. Aparecerá en el centro de la vista y podrás arrastrarla a su lugar.</p>}
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
