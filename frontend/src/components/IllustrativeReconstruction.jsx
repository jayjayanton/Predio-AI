import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildIllustrativeModel, RECONSTRUCTION_LIMITS } from '../illustrativeReconstruction.js';
import { formatDrawingNumber, parseKnownMetres } from '../measurementPresentation.js';
import ReconstructionScene from './ReconstructionScene.jsx';
import '../styles/illustrative-reconstruction.css';

const ROOFS = {none: 'Sin cubierta', flat: 'Cubierta plana supuesta', gable: 'Cubierta a dos aguas supuesta'};
const initialDraft = {height: '2,60', roof: 'none', pitch: '20', axis: 'x'};
const failureMessage = reason => ({
  invalid_height: `Indica una altura entre ${RECONSTRUCTION_LIMITS.minHeightMetres.toLocaleString('es-EC')} y ${RECONSTRUCTION_LIMITS.maxHeightMetres} m.`,
  invalid_pitch: `Indica una pendiente entre ${RECONSTRUCTION_LIMITS.minRoofPitchDegrees}° y ${RECONSTRUCTION_LIMITS.maxRoofPitchDegrees}°.`,
  model_size_range: 'El contorno tiene dimensiones fuera del rango ilustrativo (0,01–200 m). Revisa la unidad o la calibración del plano.',
  complexity_limit: 'Este contorno es demasiado complejo para la ilustración. Selecciona un contorno cerrado más sencillo.',
  scale_required: 'Confirma la unidad o calibra la escala en Medidas antes de crear la ilustración.',
}[reason] || 'Este contorno no permite crear un volumen válido. Selecciona un único contorno exterior cerrado y revisa su escala.');

export default function IllustrativeReconstruction({element, metresPerUnit, sourceViewName, unitWarning, onReturnToDrawing, onClose, sectionRef}) {
  const id = useId(); const section = useRef(null);
  const [draft, setDraft] = useState(initialDraft);
  const [appliedDraft, setAppliedDraft] = useState(initialDraft);
  const [settings, setSettings] = useState({heightMetres: 2.6, roofType: 'none', roofPitchDegrees: 20, ridgeAxis: 'x'});
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState('');
  const [hasApplied, setHasApplied] = useState(false);
  const [notice, setNotice] = useState('');
  const model = useMemo(() => buildIllustrativeModel({element, metresPerUnit, ...settings}), [element, metresPerUnit, settings]);
  const dirty = Object.keys(draft).some(key => draft[key] !== appliedDraft[key]);
  useEffect(() => {
    section.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
    section.current?.focus({preventScroll: true});
  }, []);
  const change = (key, value) => { setDraft(current => ({...current, [key]: value})); setError(''); setErrorField(''); setNotice(''); };
  const apply = event => {
    event.preventDefault();
    const next = {heightMetres: parseKnownMetres(draft.height), roofType: draft.roof,
      roofPitchDegrees: parseKnownMetres(draft.pitch), ridgeAxis: draft.axis};
    const result = buildIllustrativeModel({element, metresPerUnit, ...next});
    if (!result.ok) { setError(failureMessage(result.reason)); setErrorField(result.reason === 'invalid_height' ? 'height' : result.reason === 'invalid_pitch' ? 'pitch' : ''); setNotice(''); return; }
    setSettings(next); setAppliedDraft({...draft}); setHasApplied(true); setError(''); setErrorField(''); setNotice('Supuestos actualizados. La geometría y las medidas del plano fuente no cambian.');
  };
  const assumptionLabel = `Altura supuesta ${formatDrawingNumber(settings.heightMetres)} m · ${ROOFS[settings.roofType]}${settings.roofType === 'gable' ? ` · ${formatDrawingNumber(settings.roofPitchDegrees)}°` : ''}`;
  return <section ref={node => { section.current = node; if (sectionRef) sectionRef.current = node; }} className="cad-illustration" tabIndex={-1} aria-labelledby={`${id}-title`}>
    <header className="cad-illustration-heading">
      <div><span className="cad-illustration-eyebrow">EXPLORAR UN SUPUESTO</span><h3 id={`${id}-title`}>Reconstrucción ilustrativa</h3></div>
      <button type="button" onClick={onClose} aria-label="Cerrar ilustración">Cerrar</button>
    </header>
    <p className="cad-illustration-intro">Se eleva el contorno exterior seleccionado. La altura y la cubierta son supuestos editables; no se han obtenido del CAD. Este volumen no reconstruye muros interiores, aberturas ni otros pisos.</p>
    {unitWarning && <p className="cad-illustration-warning">{unitWarning}</p>}
    <form className="cad-illustration-form" onSubmit={apply} noValidate>
      <label htmlFor={`${id}-height`}>{draft.roof === 'gable' ? 'Altura hasta alero (supuesta)' : 'Altura supuesta'} · m
        <input id={`${id}-height`} aria-label="Altura supuesta en metros" inputMode="decimal" value={draft.height} onChange={event => change('height', event.target.value)} aria-invalid={errorField === 'height'} aria-describedby={errorField === 'height' ? `${id}-error` : undefined} /></label>
      <label htmlFor={`${id}-roof`}>Cubierta supuesta<select id={`${id}-roof`} aria-label="Cubierta supuesta" value={draft.roof} onChange={event => change('roof', event.target.value)}>
        <option value="none">Sin cubierta</option><option value="flat">Plana</option><option value="gable">Dos aguas</option>
      </select></label>
      {draft.roof === 'gable' && <>
        <label htmlFor={`${id}-pitch`}>Pendiente supuesta · °<input id={`${id}-pitch`} aria-label="Pendiente supuesta en grados" inputMode="decimal" value={draft.pitch} onChange={event => change('pitch', event.target.value)} aria-invalid={errorField === 'pitch'} aria-describedby={errorField === 'pitch' ? `${id}-error` : undefined} /></label>
        <label htmlFor={`${id}-axis`}>Dirección de cumbrera<select id={`${id}-axis`} aria-label="Dirección supuesta de cumbrera" value={draft.axis} onChange={event => change('axis', event.target.value)}><option value="x">Paralela al eje X del plano</option><option value="y">Paralela al eje Y del plano</option></select></label>
      </>}
      <div className="cad-illustration-submit"><button type="submit">Actualizar ilustración</button><span role="status">{dirty ? 'Cambios sin aplicar; la vista conserva los últimos supuestos aplicados.' : notice || (hasApplied ? 'La vista muestra tus últimos supuestos aplicados.' : 'Valores iniciales de ejemplo; ajústalos según tu hipótesis.')}</span></div>
      {error && <p id={`${id}-error`} className="cad-illustration-error" role="alert">{error}</p>}
    </form>
    {!model.ok ? <p className="cad-illustration-error" role="alert">{failureMessage(model.reason)}</p> : <>
      <ReconstructionScene model={model} assumptionLabel={assumptionLabel} />
      <div className="cad-illustration-metrics">
        <div><span>Base del plano · contorno exterior</span><strong className="cad-illustration-area">{formatDrawingNumber(model.areaM2)} <small>m²</small></strong><small>Con la escala confirmada por ti</small></div>
        <div><span>{settings.roofType === 'gable' ? 'Altura hasta alero · supuesta' : 'Altura · supuesta'}</span><strong>{formatDrawingNumber(settings.heightMetres)} <small>m</small></strong><small>Introducida para esta ilustración</small></div>
        <div><span>Altura máxima · ilustrativa</span><strong className="cad-illustration-height">{formatDrawingNumber(model.maxHeightMetres)} <small>m</small></strong><small>{settings.roofType === 'gable' ? 'Incluye la cumbrera supuesta' : 'Sin inferir alturas del archivo'}</small></div>
      </div>
      {model.ignoredRingCount > 0 && <p className="cad-illustration-warning">Se utiliza solo el contorno exterior. {model.ignoredRingCount} recortes o trazos interiores no se descuentan ni se convierten en huecos; pueden ser máscaras gráficas del CAD.</p>}
      {model.approximate && <p className="cad-illustration-warning">El contorno incluye curvas aproximadas por tramos; la ilustración conserva esa aproximación.</p>}
    </>}
    <div className="cad-illustration-source"><p><strong>Fuente de la base:</strong> {sourceViewName} · {element.layer} · {element.source_handle || element.source_id || element.id}. Las vistas de frente y lado representan este volumen supuesto; no sustituyen una sección o elevación del proyecto.</p><button type="button" onClick={onReturnToDrawing}>Volver al plano fuente</button></div>
    <p className="cad-illustration-session">La ilustración se reinicia al cambiar de contorno, vista, archivo o escala. No se guarda como modelo de proyecto.</p>
  </section>;
}
