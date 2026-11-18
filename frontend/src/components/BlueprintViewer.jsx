import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import MeasurementPanel from './MeasurementPanel.jsx';
import { hasPartialExtraction, drawingExtractionMessages, drawingRepresentationMessages } from '../drawingExtraction.js';
import { scaleForView } from '../measurementPresentation.js';
import { getExteriorContour } from '../drawingMeasurements.js';
import { findClosedContours } from '../contourSelection.js';
import {
  buildSpatialIndex, filterDrawingItems, fitTransform, hitTest, isText, prepareDrawing,
  rectangle, selectInRectangle, toScreen, toWorld, unionBounds, updateSelection, zoomAt,
} from '../drawingGeometry.js';
import '../styles/blueprint-viewer.css';

const EMPTY_VIEWS = [];
const EMPTY_VIEW = {};
const PAGE_SIZE = 20;
const number = value => value.toLocaleString('es-EC');
const kindName = item => ({line: 'Línea', polyline: 'Polilínea', curve: 'Curva', hatch_boundary: 'Trama / contorno', text: 'Texto original'}[item.kind] || 'Geometría');
const viewName = (view, index) => view.name || view.label || (view.extraction?.scope === 'modelspace' ? 'Espacio modelo' : `Página ${view.page || index + 1}`);

function addPath(context, item, scale) {
  const paths = item.rings.length ? item.rings : [item.points];
  for (const path of paths) {
    if (!path.length) continue;
    context.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i += 1) context.lineTo(path[i][0], path[i][1]);
    if (item.closed || item.rings.length) context.closePath();
    if (path.length === 1) {
      const radius = 1.5 / scale;
      context.moveTo(path[0][0] - radius, path[0][1]); context.lineTo(path[0][0] + radius, path[0][1]);
    }
  }
}

function paintDrawing(canvas, size, transform, items, selected, viewport = null, measurementOutline = null) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.max(1, Math.round(size.width * ratio));
  const pixelHeight = Math.max(1, Math.round(size.height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size.width, size.height);
  context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height);
  context.setTransform(ratio * transform.scale, 0, 0, ratio * transform.scale, ratio * transform.x, ratio * transform.y);
  context.lineJoin = 'round'; context.lineCap = 'round';
  const textItems = []; const normal = []; const hatchPattern = []; const highlighted = [];
  for (const item of items) {
    if (isText(item)) { textItems.push(item); continue; }
    const exteriorSelected = selected.has(item.id) && item.id === measurementOutline?.id;
    if (exteriorSelected) { normal.push(item); highlighted.push(measurementOutline); }
    else (selected.has(item.id) ? highlighted : item.hatch_pattern ? hatchPattern : normal).push(item);
    if (item.filled) {
      context.beginPath(); addPath(context, item, transform.scale);
      context.fillStyle = selected.has(item.id) && !exteriorSelected ? '#fce2ce' : '#e3eae8'; context.fill('evenodd');
    }
  }
  // Batch strokes rather than mount one DOM node per CAD entity.
  for (const [paths, color, width] of [[hatchPattern, '#a3b6b5', 0.65], [normal, '#30484f', 1], [highlighted, '#d45c1e', 2.4]]) {
    context.beginPath();
    for (const item of paths) addPath(context, item, transform.scale);
    context.strokeStyle = color; context.lineWidth = width / transform.scale; context.stroke();
  }
  for (const item of textItems) {
    context.save(); context.translate(item.position[0], item.position[1]);
    if (item.text_transform) context.transform(...item.text_transform, 0, 0);
    else context.rotate(item.rotation * Math.PI / 180);
    const fontHeight = item.text_transform ? 1 : item.height;
    context.font = `${fontHeight}px Arial, sans-serif`;
    context.textAlign = item.alignment; context.textBaseline = 'alphabetic';
    context.fillStyle = selected.has(item.id) ? '#b44716' : '#30484f';
    item.text.split('\n').forEach((line, index) => context.fillText(line, 0, item.baselineOffset + index * fontHeight * 1.2));
    context.restore();
    if (selected.has(item.id)) {
      context.beginPath(); context.moveTo(...item.corners[0]);
      item.corners.slice(1).forEach(point => context.lineTo(...point)); context.closePath();
      context.strokeStyle = '#d45c1e'; context.lineWidth = 1.5 / transform.scale; context.stroke();
    }
  }
  if (viewport) {
    context.fillStyle = '#176d7040'; context.strokeStyle = '#176d70'; context.lineWidth = 1.5 / transform.scale;
    context.fillRect(viewport[0], viewport[1], viewport[2] - viewport[0], viewport[3] - viewport[1]);
    context.strokeRect(viewport[0], viewport[1], viewport[2] - viewport[0], viewport[3] - viewport[1]);
  }
}

/** Imported geometry, source annotations and estimates with user-confirmed scale. */
export default function BlueprintViewer({ views = EMPTY_VIEWS, cadLayouts = EMPTY_VIEWS, documentFormat = '', unitsCode = null }) {
  const [viewIndex, setViewIndex] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [focusedId, setFocusedId] = useState(null);
  const [hiddenLayers, setHiddenLayers] = useState(new Set());
  const [showText, setShowText] = useState(true);
  const [multiple, setMultiple] = useState(true);
  const [tool, setTool] = useState('select');
  const [expanded, setExpanded] = useState(false);
  const [showOverview, setShowOverview] = useState(true);
  const [query, setQuery] = useState('');
  const [listMode, setListMode] = useState('visible');
  const [listPage, setListPage] = useState(1);
  const [layerQuery, setLayerQuery] = useState('');
  const [size, setSize] = useState({width: 800, height: 560});
  const [transform, setTransform] = useState({scale: 1, x: 0, y: 0});
  const [selectionBox, setSelectionBox] = useState(null);
  const [scaleRecord, setScaleRecord] = useState(null);
  const [areaModeRecord, setAreaModeRecord] = useState(null);
  const [contourResult, setContourResult] = useState(null);
  const canvasRef = useRef(null); const stageRef = useRef(null); const overviewRef = useRef(null);
  const measurementRef = useRef(null);
  const drag = useRef(null); const pointers = useRef(new Map()); const pinch = useRef(null); const spacePressed = useRef(false);
  const instructionsId = useId();
  const measurementPanelId = useId();
  const view = views[viewIndex] || views[0] || EMPTY_VIEW;
  const measurementScale = scaleForView(scaleRecord, view);
  const drawing = useMemo(() => prepareDrawing(view), [view]);
  const index = useMemo(() => buildSpatialIndex(drawing.items, drawing.bounds), [drawing]);
  const visible = useMemo(() => filterDrawingItems(drawing.items, {hiddenLayers, showText}), [drawing, hiddenLayers, showText]);
  const visibleIds = useMemo(() => new Set(visible.map(item => item.id)), [visible]);
  const selectedItems = useMemo(() => drawing.items.filter(item => selected.has(item.id)), [drawing, selected]);
  const selectedVisible = useMemo(() => selectedItems.filter(item => visibleIds.has(item.id)), [selectedItems, visibleIds]);
  const exteriorChoice = useMemo(() => selectedItems.length === 1 ? getExteriorContour(selectedItems[0]) : null, [selectedItems]);
  // An exterior measurement belongs to this exact selection and imported view.
  // Changing the selection cannot silently carry its area convention forward.
  const exteriorActive = areaModeRecord?.view === view && areaModeRecord?.selection === selected
    && areaModeRecord?.mode === 'exterior' && exteriorChoice?.available;
  const measurementOutline = exteriorActive ? exteriorChoice.element : null;
  const measurementItems = useMemo(() => measurementOutline ? [measurementOutline] : selectedItems, [measurementOutline, selectedItems]);
  const contourFeedback = contourResult?.view === view && contourResult?.selection === selected
    && contourResult?.visibleIds === visibleIds ? contourResult : null;
  const focused = drawing.byId.get(focusedId) || selectedItems.at(-1);
  const fit = useMemo(() => fitTransform(drawing.bounds, size.width, size.height), [drawing, size]);
  const layers = useMemo(() => {
    const groups = new Map();
    for (const item of drawing.items) groups.set(item.layer, (groups.get(item.layer) || 0) + 1);
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [drawing]);
  const layerResults = useMemo(() => layers.filter(([name]) => name.toLocaleLowerCase('es').includes(layerQuery.toLocaleLowerCase('es'))), [layers, layerQuery]);
  const results = useMemo(() => filterDrawingItems(drawing.items, {
    hiddenLayers: listMode === 'selected' ? new Set() : hiddenLayers,
    showText: listMode === 'selected' ? true : showText, query,
    selected: listMode === 'selected' ? selected : null,
  }).filter(item => listMode !== 'text' || isText(item)), [drawing, hiddenLayers, showText, query, listMode, selected]);
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(listPage, totalPages);
  const pageItems = results.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const partial = hasPartialExtraction(view.extraction) || drawing.invalidCount > 0;
  const omissionMessages = drawingExtractionMessages(view.extraction);
  const representationMessages = drawingRepresentationMessages(view.extraction);
  const viewport = rectangle(toWorld([0, 0], transform), toWorld([size.width, size.height], transform));
  const overviewTransform = useMemo(() => fitTransform(drawing.bounds, 220, 135, 10), [drawing]);
  const overviewViewport = rectangle(toScreen(viewport.slice(0, 2), overviewTransform), toScreen(viewport.slice(2), overviewTransform));

  useEffect(() => { setViewIndex(0); }, [views]);
  useEffect(() => {
    setSelected(new Set()); setFocusedId(null); setHiddenLayers(new Set()); setQuery('');
    setListPage(1); setListMode('visible'); setLayerQuery(''); setShowText(true);
    setScaleRecord(null);
    setAreaModeRecord(null); setContourResult(null);
    setSelectionBox(null); drag.current = null; pointers.current.clear(); pinch.current = null;
  }, [view]);
  useEffect(() => { setTransform(fit); }, [fit]);
  useEffect(() => { setListPage(1); }, [query, listMode, hiddenLayers, showText, view]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const measure = () => {
      const box = stage.getBoundingClientRect();
      setSize(old => old.width === box.width && old.height === box.height ? old : {width: Math.max(1, box.width), height: Math.max(1, box.height)});
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      const box = rectangle(toWorld([-12, -12], transform), toWorld([size.width + 12, size.height + 12], transform));
      paintDrawing(canvasRef.current, size, transform, index.query(box).filter(item => visibleIds.has(item.id)), selected, null, measurementOutline);
    });
    return () => cancelAnimationFrame(frame);
  }, [index, size, transform, visibleIds, selected, measurementOutline]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!overviewRef.current) return;
      paintDrawing(overviewRef.current, {width: 220, height: 135}, overviewTransform, visible, selected, null, measurementOutline);
    });
    return () => cancelAnimationFrame(frame);
  }, [overviewTransform, visible, selected, showOverview, measurementOutline]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const wheel = event => {
      event.preventDefault();
      const box = canvas.getBoundingClientRect(); const anchor = [event.clientX - box.left, event.clientY - box.top];
      setTransform(current => zoomAt(current, Math.exp(-Math.max(-150, Math.min(150, event.deltaY)) * 0.008), anchor, fit.scale / 5, fit.scale * 500));
    };
    canvas.addEventListener('wheel', wheel, {passive: false});
    return () => canvas.removeEventListener('wheel', wheel);
  }, [fit]);
  useEffect(() => {
    if (!expanded) return undefined;
    const close = event => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded]);

  const zoom = factor => setTransform(current => zoomAt(current, factor, [size.width / 2, size.height / 2], fit.scale / 5, fit.scale * 500));
  const frameItems = items => {
    const bounds = unionBounds(items.map(item => item.bounds));
    if (bounds) setTransform(zoomAt(fitTransform(bounds, size.width, size.height, 55), 1, [size.width / 2, size.height / 2], fit.scale / 5, fit.scale * 500));
  };
  const choose = (ids, additive = multiple, toggle = false) => setSelected(current => updateSelection(current, ids, {additive, toggle}));
  const returnToDrawing = () => {
    stageRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
    canvasRef.current?.focus({preventScroll: true});
  };
  const chooseContour = choice => {
    const nextSelection = new Set([choice.item.id]);
    setSelected(nextSelection); setFocusedId(choice.item.id);
    setAreaModeRecord({view, selection: nextSelection, mode: 'exterior'});
    setContourResult({view, selection: nextSelection, visibleIds, choices: [],
      notice: 'Contorno exterior seleccionado. Revisa el borde naranja y abre Medidas para ver su área.'});
  };
  const startContourSelection = () => { setTool('contour'); setContourResult(null); returnToDrawing(); };
  const eventPoint = event => { const box = event.currentTarget.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top]; };
  const startPointer = event => {
    if (![0, 1].includes(event.button)) return;
    event.currentTarget.focus({preventScroll: true});
    const point = eventPoint(event); pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {distance: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], transform};
      drag.current = null; setSelectionBox(null); return;
    }
    drag.current = {point, last: point, transform, pointerId: event.pointerId,
      mode: event.button === 1 || spacePressed.current ? 'pan' : tool,
      additive: multiple || event.shiftKey || event.ctrlKey || event.metaKey, moved: false};
  };
  const movePointer = event => {
    const point = eventPoint(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, point);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]; const center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const gesture = pinch.current;
      const next = zoomAt(gesture.transform, Math.hypot(a[0] - b[0], a[1] - b[1]) / gesture.distance, gesture.center, fit.scale / 5, fit.scale * 500);
      setTransform({...next, x: next.x + center[0] - gesture.center[0], y: next.y + center[1] - gesture.center[1]}); return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.last = point;
    if (Math.hypot(point[0] - current.point[0], point[1] - current.point[1]) > 4) current.moved = true;
    if (!current.moved) return;
    if (current.mode === 'rectangle') setSelectionBox(rectangle(current.point, point));
    else setTransform({...current.transform, x: current.transform.x + point[0] - current.point[0], y: current.transform.y + point[1] - current.point[1]});
  };
  const endPointer = (event, cancelled = false) => {
    pointers.current.delete(event.pointerId);
    if (pinch.current) { pinch.current = null; drag.current = null; return; }
    const current = drag.current; drag.current = null; setSelectionBox(null);
    if (!current || current.pointerId !== event.pointerId || cancelled) return;
    const point = eventPoint(event);
    if (current.mode === 'rectangle' && current.moved) {
      const box = rectangle(toWorld(current.point, current.transform), toWorld(point, current.transform));
      const items = selectInRectangle(index.query(box).filter(item => visibleIds.has(item.id)), box);
      choose(items.map(item => item.id), current.additive);
      if (items.length) setFocusedId(items.at(-1).id);
    } else if (!current.moved && current.mode !== 'pan') {
      const world = toWorld(point, transform); const tolerance = 7 / transform.scale;
      const candidates = index.query([world[0] - tolerance, world[1] - tolerance, world[0] + tolerance, world[1] + tolerance]).filter(item => visibleIds.has(item.id));
      if (current.mode === 'contour') {
        const result = findClosedContours(candidates, world, tolerance);
        if (result.choices.length === 1) chooseContour(result.choices[0]);
        else setContourResult({view, selection: selected, visibleIds, choices: result.choices,
          notice: result.choices.length > 1 ? 'Hay varios contornos en este punto. Elige cuál medir y revisa el borde resaltado.'
            : result.reason === 'complexity_limit' ? 'Hay demasiados contornos en este punto. Oculta las capas que no necesitas y vuelve a elegir.'
            : 'No se encontró un contorno cerrado válido en este punto. Prueba dentro de otra zona o revisa las capas visibles.'});
        return;
      }
      const item = hitTest(candidates, world, tolerance);
      if (item) { setFocusedId(item.id); choose([item.id], current.additive, current.additive); }
      else if (!current.additive) setSelected(new Set());
    }
  };
  const canvasKey = event => {
    if (event.key === ' ') { event.preventDefault(); spacePressed.current = true; return; }
    if (['+', '='].includes(event.key)) { event.preventDefault(); zoom(1.5); }
    else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.5); }
    else if (event.key.toLowerCase() === 'f') { event.preventDefault(); setTransform(fit); }
    else if (event.key === 'Escape') { setSelected(new Set()); setSelectionBox(null); }
    else if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); choose(visible.map(item => item.id), false); }
    else if (event.key.startsWith('Arrow')) {
      event.preventDefault(); const step = event.shiftKey ? 120 : 40;
      setTransform(current => ({...current, x: current.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0), y: current.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)}));
    }
  };
  const overviewClick = event => {
    const box = event.currentTarget.getBoundingClientRect();
    const point = [(event.clientX - box.left) * 220 / box.width, (event.clientY - box.top) * 135 / box.height];
    const world = toWorld(point, overviewTransform);
    setTransform(current => ({...current, x: size.width / 2 - world[0] * current.scale, y: size.height / 2 - world[1] * current.scale}));
  };

  return (
    <section className={`blueprint-viewer cad-viewer${expanded ? ' blueprint-expanded' : ''}`} aria-label="Visor de dibujo importado">
      <div className="blueprint-toolbar cad-toolbar">
        <div><strong>Dibujo importado</strong><p className="cad-subtitle">Inspección de geometría y textos de origen · {measurementScale ? 'estimaciones con escala confirmada por ti' : 'escala pendiente de confirmación'}</p></div>
        <div className="blueprint-tools">
          <button type="button" className="cad-measurements-shortcut" aria-controls={measurementPanelId} onClick={() => { measurementRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'}); measurementRef.current?.focus({preventScroll: true}); }}>Medidas</button>
          <button type="button" onClick={() => zoom(1.5)} aria-label="Acercar dibujo">＋</button>
          <button type="button" onClick={() => zoom(1 / 1.5)} aria-label="Alejar dibujo">−</button>
          <button type="button" onClick={() => setTransform(fit)}>Ajustar todo</button>
          <button type="button" disabled={!selectedVisible.length} onClick={() => frameItems(selectedVisible)}>Ajustar selección</button>
          <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? 'Cerrar ampliación' : 'Ampliar visor'}</button>
        </div>
      </div>
      <div className="cad-counts" role="status" aria-live="polite">
        <span><strong>{number(drawing.items.length)}</strong> elementos importados</span>
        <span><strong>{number(visible.length)}</strong> visibles</span>
        <span><strong>{number(selected.size)}</strong> seleccionados{selected.size > selectedVisible.length ? ` (${number(selected.size - selectedVisible.length)} ocultos)` : ''}</span>
        <span>{number(drawing.textCount)} textos incluidos</span>
      </div>
      {partial && <details className="cad-warning" open>
        <summary>Contenido parcial: hay elementos que no se representan</summary>
        <ul>{omissionMessages.map(message => <li key={message}>{message}</li>)}
          {drawing.invalidCount > 0 && <li>{number(drawing.invalidCount)} elementos recibidos tienen coordenadas no válidas y no pueden mostrarse.</li>}
        </ul><p>Revisa estas omisiones junto al archivo original antes de usar el dibujo para decisiones de obra.</p>
      </details>}
      {representationMessages.length > 0 && <div className="cad-representation">{representationMessages.map(message => <p key={message}>{message}</p>)}</div>}
      <div className="cad-workspace">
        <div className="cad-main">
          <div className="cad-controls">
            {views.length > 1 && <label className="cad-view-choice">Vista <select value={viewIndex} onChange={event => setViewIndex(Number(event.target.value))}>
              {views.map((item, i) => <option key={`${item.page}-${i}`} value={i}>{viewName(item, i)}</option>)}
            </select></label>}
            <div className="cad-tool-group" aria-label="Herramienta del visor">
              {[['select', 'Seleccionar'], ['contour', 'Área de contorno'], ['rectangle', 'Rectángulo'], ['pan', 'Mover']].map(([value, label]) => <button key={value} type="button" aria-pressed={tool === value} onClick={() => { setTool(value); setContourResult(null); }}>{label}</button>)}
            </div>
            <label className="cad-inline-check"><input type="checkbox" checked={multiple} disabled={tool === 'contour'} onChange={event => setMultiple(event.target.checked)} /> Acumular selección</label>
          </div>
          {tool === 'contour' && <div className="cad-contour-help">
            <p>Toca dentro de un contorno cerrado del CAD. Se selecciona uno a la vez y se mide su exterior, sin descontar recortes interiores. Revisa el borde naranja; no identifica automáticamente una habitación.</p>
            {contourFeedback && <p role="status">{contourFeedback.notice}</p>}
            {contourFeedback?.choices.length > 1 && <div className="cad-contour-choices">{contourFeedback.choices.map(choice => <button type="button" key={choice.item.id} onClick={() => chooseContour(choice)}>
              {kindName(choice.item)} · {choice.item.source_handle || choice.item.source_id} · {choice.item.layer}
            </button>)}</div>}
          </div>}
          <div className={`cad-stage cad-tool-${tool}`} ref={stageRef}>
            <canvas ref={canvasRef} className="cad-drawing-canvas" tabIndex={0} role="img"
              aria-label={`${viewName(view, viewIndex)}. ${visible.length} elementos visibles. Usa la lista para seleccionar con teclado.`}
              aria-describedby={instructionsId}
              onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={event => endPointer(event)}
              onPointerCancel={event => endPointer(event, true)} onLostPointerCapture={event => { pointers.current.delete(event.pointerId); }}
              onKeyDown={canvasKey} onKeyUp={event => { if (event.key === ' ') spacePressed.current = false; }} onBlur={() => { spacePressed.current = false; }} />
            {selectionBox && <div className="cad-selection-box" style={{left: selectionBox[0], top: selectionBox[1], width: selectionBox[2] - selectionBox[0], height: selectionBox[3] - selectionBox[1]}} />}
            {!visible.length && <div className="cad-empty">{drawing.items.length ? 'No hay elementos visibles con estos filtros. Activa las capas o los textos.' : 'No se recibió geometría seleccionable para esta vista. Los planos escaneados necesitan otro procesamiento.'}</div>}
            <div className="cad-overview"><button type="button" className="cad-overview-title" aria-expanded={showOverview} onClick={() => setShowOverview(value => !value)}>Vista general · {showOverview ? 'ocultar' : 'mostrar'}</button>
              {showOverview && <><div className="cad-overview-map"><canvas ref={overviewRef} onClick={overviewClick} aria-hidden="true" title="Dibujo importado: haz clic para centrar la inspección en esta zona" />
                <div className="cad-overview-viewport" style={{left: `${overviewViewport[0] / 220 * 100}%`, top: `${overviewViewport[1] / 135 * 100}%`, width: `${(overviewViewport[2] - overviewViewport[0]) / 220 * 100}%`, height: `${(overviewViewport[3] - overviewViewport[1]) / 135 * 100}%`}} />
              </div><button type="button" onClick={() => setTransform(fit)}>Ver todo el dibujo importado</button></>}
            </div>
            <span className="cad-zoom">{Math.round(transform.scale / fit.scale * 100)} %</span>
          </div>
          <p className="cad-help" id={instructionsId}>Clic: seleccionar. Arrastrar: desplazar; en Rectángulo, seleccionar lo que cruza el recuadro. Rueda o dos dedos: zoom. Teclado: flechas, + / − y F para ajustar. La lista ofrece selección sin usar el lienzo.</p>
          <p className="cad-source-note">La vista general y el detalle se generan con los datos importados; no son una reproducción independiente del archivo original. Las áreas, cotas y nombres escritos son anotaciones del plano, sin verificar. Los cálculos geométricos de la selección se muestran por separado en Medidas.</p>
          {cadLayouts.length > 0 && <details className="cad-layouts"><summary>Vistas y presentaciones del CAD ({cadLayouts.length})</summary>
            <p>{cadLayouts.map(layout => `${layout.name}${layout.displayed ? ' (disponible)' : ' (sin representación)'}`).join(' · ')}</p><p>Las presentaciones son vistas del archivo; sus nombres no confirman cuántos pisos hay.</p>
          </details>}
        </div>
        <aside className="cad-inspector" aria-label="Capas y elementos del dibujo">
          <MeasurementPanel key={`${viewIndex}-${view.page || 1}`} panelId={measurementPanelId} sectionRef={measurementRef}
            elements={measurementItems} hiddenSelectedCount={selectedItems.length - selectedVisible.length}
            documentFormat={documentFormat} unitsCode={unitsCode} scope={view.extraction?.scope} viewIdentity={view}
            scale={measurementScale} onScaleChange={next => setScaleRecord(next ? {...next, view} : null)}
            areaMode={exteriorActive ? 'exterior' : 'source'} exteriorChoice={exteriorChoice}
            onAreaModeChange={mode => setAreaModeRecord(mode === 'exterior' ? {view, selection: selected, mode} : null)}
            onChooseContour={startContourSelection} onReturnToDrawing={returnToDrawing}
            onClearSelection={() => { setSelected(new Set()); setFocusedId(null); }} />
          <details className="cad-layers" open><summary>Capas ({number(layers.length)})</summary>
            <label className="cad-search">Buscar capa<input type="search" value={layerQuery} onChange={event => setLayerQuery(event.target.value)} placeholder="Nombre de capa" /></label>
            <div className="cad-actions"><button type="button" onClick={() => setHiddenLayers(new Set())}>Mostrar todas</button><button type="button" onClick={() => setHiddenLayers(new Set(layers.map(([name]) => name)))}>Ocultar todas</button></div>
            <div className="cad-layer-list">{layerResults.map(([name, count]) => <div className="cad-layer-row" key={name}>
              <label><input type="checkbox" checked={!hiddenLayers.has(name)} onChange={event => setHiddenLayers(current => { const next = new Set(current); event.target.checked ? next.delete(name) : next.add(name); return next; })} /><span>{name}</span><small>{number(count)}</small></label>
              <button type="button" title={`Seleccionar los elementos visibles de ${name}`} aria-label={`Seleccionar capa ${name}`} disabled={hiddenLayers.has(name)} onClick={() => choose(visible.filter(item => item.layer === name).map(item => item.id), multiple)}>Elegir</button>
            </div>)}</div>
            {!layerResults.length && <p className="cad-muted">No hay capas con ese nombre.</p>}
            <label className="cad-inline-check"><input type="checkbox" checked={showText} onChange={event => setShowText(event.target.checked)} /> Mostrar textos originales ({number(drawing.textCount)})</label>
          </details>
          <div className="cad-selection-actions">
            <button type="button" disabled={!visible.length} onClick={() => choose(visible.map(item => item.id), false)}>Seleccionar todo visible ({number(visible.length)})</button>
            <button type="button" disabled={!selected.size} onClick={() => { setSelected(new Set()); setFocusedId(null); }}>Limpiar selección</button>
          </div>
          <section className="cad-item-section"><h3>Explorar elementos</h3>
            <label className="cad-search">Buscar por ID, capa o texto<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ID, A-WALL, dormitorio…" /></label>
            <label className="cad-list-filter">Mostrar<select value={listMode} onChange={event => setListMode(event.target.value)}><option value="visible">Todos los visibles</option><option value="selected">Seleccionados, incluidos ocultos</option><option value="text">Textos visibles</option></select></label>
            <p className="cad-result-count">{number(results.length)} resultados{results.length > 0 ? ` · ${number((currentPage - 1) * PAGE_SIZE + 1)}–${number(Math.min(currentPage * PAGE_SIZE, results.length))}` : ''}</p>
            <ul className="cad-item-list">{pageItems.map(item => <li key={item.id} className={selected.has(item.id) ? 'is-selected' : ''}>
              <label><input type="checkbox" checked={selected.has(item.id)} onChange={event => { const checked = event.target.checked; setFocusedId(item.id); setSelected(current => { if (checked) return updateSelection(current, [item.id], {additive: multiple}); const next = new Set(current); next.delete(item.id); return next; }); }} />
                <span><strong>{isText(item) ? item.text : `${kindName(item)} · ${item.source_handle || item.source_id}`}</strong><small>{item.layer}{!visibleIds.has(item.id) ? ' · Oculto' : ''}</small></span></label>
              <button type="button" aria-label={`Localizar ${item.source_id}`} onClick={() => { setFocusedId(item.id); choose([item.id], multiple); setHiddenLayers(current => { if (!current.has(item.layer)) return current; const next = new Set(current); next.delete(item.layer); return next; }); if (isText(item)) setShowText(true); frameItems([item]); }}>Ver</button>
            </li>)}</ul>
            {!results.length && <p className="cad-muted">No hay elementos que coincidan.</p>}
            <nav className="cad-pagination" aria-label="Páginas de elementos">
              <button type="button" disabled={currentPage === 1} onClick={() => setListPage(1)} aria-label="Primera página">«</button><button type="button" disabled={currentPage === 1} onClick={() => setListPage(currentPage - 1)} aria-label="Página anterior">‹</button><span>{currentPage} / {totalPages}</span>
              <button type="button" disabled={currentPage === totalPages} onClick={() => setListPage(currentPage + 1)} aria-label="Página siguiente">›</button><button type="button" disabled={currentPage === totalPages} onClick={() => setListPage(totalPages)} aria-label="Última página">»</button>
            </nav>
          </section>
          {focused && <section className="cad-source-detail"><h3>Origen del elemento</h3>
            <dl><dt>ID importado</dt><dd>{focused.source_id}</dd><dt>Tipo</dt><dd>{focused.source_type || kindName(focused)}</dd><dt>Capa</dt><dd>{focused.layer}</dd>
              {focused.source_handle && <><dt>ID en archivo</dt><dd>{focused.source_handle}</dd></>}
              {focused.dimension_handle && <><dt>Cota de origen</dt><dd>{focused.dimension_handle} · texto y geometría sin verificar</dd></>}
              {focused.block_path?.length > 0 && <><dt>Ruta de bloques</dt><dd>{focused.block_path.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' → ')}</dd></>}
              {isText(focused) && <><dt>Texto original</dt><dd className="cad-literal-text">{focused.text}</dd></>}
              {focused.approximation && <><dt>Representación</dt><dd>Curva aproximada con tramos para visualizar. Se selecciona la entidad de origen completa.</dd></>}
            </dl><p>{measurementScale ? 'Escala confirmada por ti; estimaciones geométricas sin verificación para obra.' : 'La escala necesita confirmación para expresar medidas en metros.'} La selección no identifica automáticamente un muro o una habitación.</p>
          </section>}
        </aside>
      </div>
    </section>
  );
}
