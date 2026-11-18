import React, { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import MeasurementPanel from './MeasurementPanel.jsx';
import ScaledDesignPanel, {GroundFootprintPanel} from './ScaledDesignPanel.jsx';
import SetbackFeedback from './SetbackFeedback.jsx';
import {evaluatePlanningShape, setbackSourceKey} from '../liveSetbacks.js';
import {commitDesign, createDesignHistory, createPlanningShape, createPlanningSnapshot, extractPlanningFootprint,
  hitPlanningShape, paintPlanningOverlay, PLANNING_LIMITS, redoDesign, shapeBounds, undoDesign,
  createDrawnPlanningShape, createPolygonPlanningShape, planningShapeMetrics, planningEditHandles,
  resizePlanningShape, updatePlanningShape, insertPlanningVertex, removePlanningVertex} from '../scaledPlanning.js';
import { hasPartialExtraction, drawingExtractionMessages, drawingRepresentationMessages } from '../drawingExtraction.js';
import { formatDrawingNumber, scaleForView } from '../measurementPresentation.js';
import { cadUnitFromCode, getExteriorContour } from '../drawingMeasurements.js';
import { findClosedContours } from '../contourSelection.js';
import {
  buildSpatialIndex, filterDrawingItems, fitTransform, hitTest, isText, prepareDrawing,
  rectangle, selectInRectangle, toScreen, toWorld, unionBounds, updateSelection, zoomAt,
} from '../drawingGeometry.js';
import '../styles/blueprint-viewer.css';
import '../styles/illustrative-reconstruction.css';
import '../styles/scaled-planning.css';

const IllustrativeReconstruction = lazy(() => import('./IllustrativeReconstruction.jsx'));

class IllustrationBoundary extends React.Component {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    return this.state.failed
      ? <div className="cad-illustration-error" role="alert"><p>No se pudo abrir la ilustración. El plano y las medidas siguen disponibles. Recarga la página si el problema continúa.</p><button type="button" onClick={this.props.onClose}>Cerrar ilustración y volver al plano</button></div>
      : this.props.children;
  }
}

const EMPTY_VIEWS = [];
const EMPTY_VIEW = {};
const PAGE_SIZE = 20;
const EMPTY_DESIGN_HISTORY = createDesignHistory();
const INSPECTOR_TABS = [['measure', 'Medidas'], ['design', 'Figuras'], ['footprint', 'Huella'], ['layers', 'Capas']];
const DRAWING_TOOLS = [['polygon', 'Polígono libre'], ['rectangle', 'Rectángulo'], ['square', 'Cuadrado'], ['triangle', 'Triángulo'], ['circle', 'Círculo']];
const POINT_TOOLS = new Set(['draw-polygon', 'draw-triangle']);
const drawingLabel = kind => ({rectangle: 'Rectángulo', square: 'Cuadrado', triangle: 'Triángulo', polygon: 'Polígono', circle: 'Círculo'}[kind] || 'Figura');
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

function paintDrawing(canvas, size, transform, items, selected, viewport = null, measurementOutline = null, planning = null) {
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
  if (planning) paintPlanningOverlay(context, transform, planning.shapes, planning.metresPerUnit,
    planning.selectedId, planning.footprint, planning.showShapes, planning.shapeChecks);
  if (viewport) {
    context.fillStyle = '#176d7040'; context.strokeStyle = '#176d70'; context.lineWidth = 1.5 / transform.scale;
    context.fillRect(viewport[0], viewport[1], viewport[2] - viewport[0], viewport[3] - viewport[1]);
    context.strokeRect(viewport[0], viewport[1], viewport[2] - viewport[0], viewport[3] - viewport[1]);
  }
}

/** Imported geometry, source annotations and estimates with user-confirmed scale. */
export default function BlueprintViewer({ views = EMPTY_VIEWS, cadLayouts = EMPTY_VIEWS, documentFormat = '', unitsCode = null, documentName = '',
  onPlanningChange, draftState = null, onDraftStateChange, setbackReview = null }) {
  const initialDraft = draftState?.views === views ? draftState : null;
  const initialIndex = initialDraft?.viewIndex || 0;
  const initialView = views[initialIndex] || views[0] || EMPTY_VIEW;
  const initialRecord = initialDraft?.records?.find(record => record.view === initialView);
  const [viewIndex, setViewIndex] = useState(initialIndex);
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
  const [scaleRecord, setScaleRecord] = useState(initialRecord?.scaleRecord || null);
  const [designRecord, setDesignRecord] = useState(() => ({view: initialView, history: initialRecord?.history || createDesignHistory()}));
  const [selectedShapeId, setSelectedShapeId] = useState(initialRecord?.selectedShapeId || null);
  const [showShapes, setShowShapes] = useState(initialRecord?.showShapes !== false);
  const [shapePreview, setShapePreview] = useState(null);
  const [drawingPreview, setDrawingPreview] = useState(null);
  const [draftPoints, setDraftPoints] = useState([]);
  const [draftCursor, setDraftCursor] = useState(null);
  const [draftError, setDraftError] = useState('');
  const [drawingRole, setDrawingRole] = useState('furniture');
  const [editMode, setEditMode] = useState('vertices');
  const [selectedVertex, setSelectedVertex] = useState(null);
  const [invalidHandlePoint, setInvalidHandlePoint] = useState(null);
  const [hoveredHandle, setHoveredHandle] = useState(null);
  const [inspectorTab, setInspectorTab] = useState('measure');
  const [planningNotice, setPlanningNotice] = useState('');
  const [areaModeRecord, setAreaModeRecord] = useState(null);
  const [contourResult, setContourResult] = useState(null);
  const [illustrationRecord, setIllustrationRecord] = useState(null);
  const canvasRef = useRef(null); const stageRef = useRef(null); const overviewRef = useRef(null);
  const measurementRef = useRef(null);
  const illustrationRef = useRef(null);
  const inspectorRef = useRef(null);
  const measurementFocusRequested = useRef(false);
  const designCache = useRef(new Map((initialDraft?.records || []).map(record => [record.view, record])));
  const sourceViews = useRef(views);
  const planningCallbacks = useRef({onPlanningChange, onDraftStateChange});
  planningCallbacks.current = {onPlanningChange, onDraftStateChange};
  const nextShapeNumber = useRef(1);
  const draftPointsRef = useRef([]);
  const drag = useRef(null); const pointers = useRef(new Map()); const pinch = useRef(null); const spacePressed = useRef(false);
  const instructionsId = useId();
  const measurementPanelId = useId();
  const view = views[viewIndex] || views[0] || EMPTY_VIEW;
  const measurementScale = scaleForView(scaleRecord, view);
  const designHistory = designRecord.view === view ? designRecord.history : EMPTY_DESIGN_HISTORY;
  const design = designHistory.present;
  const drawingTool = tool.startsWith('draw-') ? tool : null;
  const pointDrawing = POINT_TOOLS.has(tool);
  const activeFootprint = design.footprint?.metresPerUnit === measurementScale?.metresPerUnit ? design.footprint : null;
  const polygonPreview = useMemo(() => {
    if (!pointDrawing || !measurementScale || !draftPoints.length) return null;
    const points = draftCursor && Math.hypot(draftCursor[0] - draftPoints.at(-1)[0], draftCursor[1] - draftPoints.at(-1)[1]) > 1e-9
      ? [...draftPoints, draftCursor] : draftPoints;
    return createPolygonPlanningShape('drawing-preview', points, measurementScale.metresPerUnit, {role: drawingRole, label: drawingLabel(tool.slice(5))});
  }, [pointDrawing, measurementScale, draftPoints, draftCursor, drawingRole, tool]);
  const activePreview = drawingPreview || polygonPreview;
  const displayShapes = useMemo(() => {
    const shapes = shapePreview ? design.shapes.map(shape => shape.id === shapePreview.id ? shapePreview : shape) : design.shapes;
    return activePreview ? [...shapes, activePreview] : shapes;
  }, [design.shapes, shapePreview, activePreview]);
  const editableShape = displayShapes.find(shape => shape.id === selectedShapeId);
  const editHandles = useMemo(() => tool === 'design' && showShapes && editableShape && measurementScale
    ? planningEditHandles(editableShape, measurementScale.metresPerUnit, editMode) : [], [tool, showShapes, editableShape, measurementScale, editMode]);
  const metricPreview = activePreview || shapePreview;
  const draftMetrics = metricPreview ? {...planningShapeMetrics(metricPreview), widthMetres: metricPreview.widthMetres, depthMetres: metricPreview.depthMetres} : null;
  const drawing = useMemo(() => prepareDrawing(view), [view]);
  const index = useMemo(() => buildSpatialIndex(drawing.items, drawing.bounds), [drawing]);
  const visible = useMemo(() => filterDrawingItems(drawing.items, {hiddenLayers, showText}), [drawing, hiddenLayers, showText]);
  const visibleIds = useMemo(() => new Set(visible.map(item => item.id)), [visible]);
  const selectedItems = useMemo(() => drawing.items.filter(item => selected.has(item.id)), [drawing, selected]);
  const selectedVisible = useMemo(() => selectedItems.filter(item => visibleIds.has(item.id)), [selectedItems, visibleIds]);
  const selectedFootprintElement = selectedItems.length === 1 && selectedVisible.length === 1 ? selectedItems[0] : null;
  const footprintChoice = useMemo(() => extractPlanningFootprint(selectedFootprintElement, measurementScale?.metresPerUnit), [selectedFootprintElement, measurementScale]);
  const exteriorChoice = useMemo(() => selectedItems.length === 1 ? getExteriorContour(selectedItems[0]) : null, [selectedItems]);
  const canIllustrate = Boolean(exteriorChoice?.available && selectedVisible.length === 1 && measurementScale);
  const illustrationVisible = canIllustrate && illustrationRecord?.view === view
    && illustrationRecord?.selection === selected && illustrationRecord?.scale === measurementScale;
  const declaredUnit = cadUnitFromCode(unitsCode);
  const illustrationUnitWarning = declaredUnit && measurementScale?.method === 'unit' && measurementScale.unit !== declaredUnit.unit
    ? `El archivo declara ${declaredUnit.label.toLocaleLowerCase('es')}, pero aplicaste ${measurementScale.unit}. Revisa la unidad en Medidas antes de interpretar el tamaño del volumen.` : '';
  const illustrationHelp = !exteriorChoice?.available || selectedVisible.length !== 1
    ? 'Elige un único contorno cerrado y visible para elevar su exterior con una altura supuesta.'
    : !measurementScale ? 'Confirma la unidad o calibra la escala en Medidas para crear el volumen.'
      : 'Crea un volumen del contorno seleccionado con altura y cubierta supuestas. No identifica automáticamente el edificio.';
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
  const planningSnapshot = useMemo(() => createPlanningSnapshot({footprint: activeFootprint, shapes: design.shapes, scale: measurementScale,
    source: {documentName, viewName: viewName(view, viewIndex), viewIndex, unitsCode}}), [activeFootprint, design.shapes, measurementScale, documentName, view, viewIndex, unitsCode]);
  const liveSourceKey = useMemo(() => setbackSourceKey(planningSnapshot), [planningSnapshot]);
  const reviewContext = setbackReview?.sourceKey === liveSourceKey ? setbackReview.context : null;
  const metricSpace = useMemo(() => ({origin: activeFootprint?.origin || [0, 0], metresPerUnit: measurementScale?.metresPerUnit}), [activeFootprint, measurementScale]);
  const committedChecks = useMemo(() => Object.fromEntries(design.shapes.map(shape => [shape.id,
    evaluatePlanningShape(shape, metricSpace, reviewContext)])), [design.shapes, metricSpace, reviewContext]);
  const previewCheck = useMemo(() => metricPreview ? evaluatePlanningShape(metricPreview, metricSpace, reviewContext) : null,
    [metricPreview, metricSpace, reviewContext]);
  const shapeChecks = useMemo(() => previewCheck ? {...committedChecks, [metricPreview.id]: previewCheck} : committedChecks,
    [committedChecks, previewCheck, metricPreview]);
  const activeSetbackCheck = drawingTool ? drawingRole === 'extension' ? previewCheck || {
    role: 'extension', status: 'pending', pending_reasons: [reviewContext?.ready ? 'drawing_incomplete' : 'review_required'], setback_edges: [],
  } : null : editableShape?.role === 'extension' ? shapeChecks[editableShape.id] : null;
  const planningPaint = useMemo(() => ({shapes: displayShapes, selectedId: selectedShapeId, metresPerUnit: measurementScale?.metresPerUnit,
    footprint: activeFootprint, showShapes, shapeChecks}), [displayShapes, selectedShapeId, measurementScale, activeFootprint, showShapes, shapeChecks]);
  const scaleBarMetres = measurementScale ? 10 ** Math.floor(Math.log10(90 * measurementScale.metresPerUnit / transform.scale)) : null;
  const scaleBarWidth = scaleBarMetres ? scaleBarMetres / measurementScale.metresPerUnit * transform.scale : null;

  useEffect(() => { setViewIndex(draftState?.views === views ? draftState.viewIndex || 0 : 0); }, [views]);
  useEffect(() => {
    if (sourceViews.current !== views) { designCache.current.clear(); sourceViews.current = views; }
    setSelected(new Set()); setFocusedId(null); setHiddenLayers(new Set()); setQuery('');
    setListPage(1); setListMode('visible'); setLayerQuery(''); setShowText(true);
    const saved = designCache.current.get(view);
    setScaleRecord(saved?.scaleRecord || null);
    setDesignRecord({view, history: saved?.history || createDesignHistory()});
    setSelectedShapeId(saved?.selectedShapeId || null); setShapePreview(null); setShowShapes(saved?.showShapes !== false);
    setDrawingPreview(null); setDraftPoints([]); draftPointsRef.current = []; setDraftCursor(null); setDraftError('');
    setEditMode('vertices'); setSelectedVertex(null); setInvalidHandlePoint(null); setHoveredHandle(null);
    setPlanningNotice(''); setTool('select');
    setAreaModeRecord(null); setContourResult(null);
    setIllustrationRecord(null);
    setSelectionBox(null); drag.current = null; pointers.current.clear(); pinch.current = null;
  }, [view, views]);
  useEffect(() => {
    if (designRecord.view !== view) return;
    designCache.current.set(view, {view, history: designHistory, scaleRecord, selectedShapeId, showShapes});
    const records = [...designCache.current.values()].filter(record => views.includes(record.view));
    planningCallbacks.current.onDraftStateChange?.({views, viewIndex, records});
  }, [views, view, viewIndex, designRecord, designHistory, scaleRecord, selectedShapeId, showShapes]);
  useEffect(() => { planningCallbacks.current.onPlanningChange?.(planningSnapshot); }, [planningSnapshot]);
  useEffect(() => {
    if (inspectorTab === 'measure' && measurementFocusRequested.current) {
      measurementFocusRequested.current = false;
      measurementRef.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
      measurementRef.current?.focus({preventScroll: true});
    }
  }, [inspectorTab]);
  useEffect(() => {
    setTransform(fit); drag.current = null; pointers.current.clear(); pinch.current = null;
    setShapePreview(null); setDrawingPreview(null); setInvalidHandlePoint(null); setSelectionBox(null); setSelectedVertex(null);
  }, [fit]);
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
      paintDrawing(canvasRef.current, size, transform, index.query(box).filter(item => visibleIds.has(item.id)), selected, null, measurementOutline, planningPaint);
    });
    return () => cancelAnimationFrame(frame);
  }, [index, size, transform, visibleIds, selected, measurementOutline, planningPaint]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!overviewRef.current) return;
      paintDrawing(overviewRef.current, {width: 220, height: 135}, overviewTransform, visible, selected, null, measurementOutline, planningPaint);
    });
    return () => cancelAnimationFrame(frame);
  }, [overviewTransform, visible, selected, showOverview, measurementOutline, planningPaint]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const wheel = event => {
      event.preventDefault();
      if (drag.current && ['shape', 'handle', 'draw-shape'].includes(drag.current.mode)) return;
      const box = canvas.getBoundingClientRect(); const anchor = [event.clientX - box.left, event.clientY - box.top];
      setTransform(current => zoomAt(current, Math.exp(-Math.max(-150, Math.min(150, event.deltaY)) * 0.008), anchor, fit.scale / 5, fit.scale * 500));
    };
    canvas.addEventListener('wheel', wheel, {passive: false});
    return () => canvas.removeEventListener('wheel', wheel);
  }, [fit]);
  useEffect(() => {
    if (!expanded) return undefined;
    const close = event => { if (event.key === 'Escape' && !event.defaultPrevented) setExpanded(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded]);

  const editingGesture = () => drag.current && ['shape', 'handle', 'draw-shape'].includes(drag.current.mode);
  const zoom = factor => { if (!editingGesture()) setTransform(current => zoomAt(current, factor, [size.width / 2, size.height / 2], fit.scale / 5, fit.scale * 500)); };
  const frameItems = items => {
    if (editingGesture()) return;
    const bounds = unionBounds(items.map(item => item.bounds));
    if (bounds) setTransform(zoomAt(fitTransform(bounds, size.width, size.height, 55), 1, [size.width / 2, size.height / 2], fit.scale / 5, fit.scale * 500));
  };
  const fitAll = () => {
    if (editingGesture()) return;
    const bounds = unionBounds([drawing.bounds, ...(measurementScale && showShapes ? design.shapes.map(shape => shapeBounds(shape, measurementScale.metresPerUnit)) : [])]);
    setTransform(fitTransform(bounds || drawing.bounds, size.width, size.height));
  };
  const choose = (ids, additive = multiple, toggle = false) => setSelected(current => updateSelection(current, ids, {additive, toggle}));
  const updateDesign = update => setDesignRecord(current => {
    const history = current.view === view ? current.history : createDesignHistory();
    const present = typeof update === 'function' ? update(history.present) : update;
    return {view, history: commitDesign(history, present)};
  });
  const clearGesture = () => {
    drag.current = null; pointers.current.clear(); pinch.current = null;
    setShapePreview(null); setDrawingPreview(null); setSelectionBox(null);
    setInvalidHandlePoint(null); setHoveredHandle(null);
  };
  const clearDraft = () => {
    clearGesture(); draftPointsRef.current = []; setDraftPoints([]); setDraftCursor(null); setDraftError('');
  };
  const chooseTool = next => { clearDraft(); setTool(next); setContourResult(null); };
  const historyAction = action => {
    clearDraft(); setSelectedVertex(null);
    if (drawingTool) setTool('design');
    setDesignRecord(current => current.view === view ? {view, history: action(current.history)} : current);
  };
  const changeScale = next => {
    const previousFactor = measurementScale?.metresPerUnit;
    clearDraft(); setSelectedVertex(null); if (drawingTool) setTool('design');
    setScaleRecord(next ? {...next, view} : null);
    if (previousFactor !== next?.metresPerUnit) {
      setDesignRecord(current => ({view, history: createDesignHistory({shapes: current.view === view ? current.history.present.shapes : [], footprint: null})}));
      setShapePreview(null);
      if (design.shapes.length || design.footprint) setPlanningNotice('La escala cambió. Las figuras conservan sus medidas en metros; revisa su posición y vuelve a confirmar la huella.');
    }
  };
  const returnToDrawing = () => {
    stageRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
    canvasRef.current?.focus({preventScroll: true});
  };
  const openInspector = tab => {
    setInspectorTab(tab);
    requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'}));
  };
  const newShapeId = () => {
    let id;
    do { id = `figure-${nextShapeNumber.current++}`; } while (design.shapes.some(shape => shape.id === id));
    return id;
  };
  const acceptDrawnShape = shape => {
    if (!shape || design.shapes.length >= PLANNING_LIMITS.maxShapes) return false;
    const id = newShapeId();
    const duplicates = design.shapes.filter(item => item.label === shape.label || item.label.startsWith(`${shape.label} `)).length;
    const next = {...shape, id, label: duplicates ? `${shape.label} ${duplicates + 1}` : shape.label};
    updateDesign(current => ({...current, shapes: [...current.shapes, next]}));
    clearDraft(); setSelectedShapeId(id); setSelectedVertex(null); setEditMode('vertices');
    setShowShapes(true); setTool('design'); setInspectorTab('design'); setPlanningNotice('');
    return true;
  };
  const startDrawing = kind => {
    if (!measurementScale) { showMeasurements(); return; }
    if (!DRAWING_TOOLS.some(([value]) => value === kind) || design.shapes.length >= PLANNING_LIMITS.maxShapes) return;
    clearDraft(); setSelectedShapeId(null); setSelectedVertex(null); setShowShapes(true);
    setTool(`draw-${kind}`); setInspectorTab('design'); setPlanningNotice(''); returnToDrawing();
  };
  const cancelDrawing = () => { clearDraft(); setTool('design'); returnToDrawing(); };
  const finishDrawing = (points = draftPointsRef.current) => {
    if (!pointDrawing || !measurementScale || points.length < 3 || (tool === 'draw-triangle' && points.length !== 3)) return false;
    const shape = createPolygonPlanningShape('draft', points, measurementScale.metresPerUnit,
      {role: drawingRole, label: drawingLabel(tool.slice(5))});
    if (!shape) { setDraftError('El contorno no es válido: evita cruces, puntos repetidos y lados sin área. Revisa también la escala y el tamaño (0,01–200 m).'); return false; }
    return acceptDrawnShape(shape);
  };
  const undoDraftPoint = () => {
    const next = draftPointsRef.current.slice(0, -1); draftPointsRef.current = next;
    setDraftPoints(next); setDraftCursor(null); setDraftError('');
  };
  const addShape = preset => {
    if (!measurementScale || design.shapes.length >= PLANNING_LIMITS.maxShapes) { showMeasurements(); return; }
    clearDraft(); const id = newShapeId();
    const shape = createPlanningShape(preset, id, toWorld([size.width / 2, size.height / 2], transform));
    if (!shape) return;
    const duplicates = design.shapes.filter(item => item.label === shape.label || item.label.startsWith(`${shape.label} `)).length;
    if (duplicates) shape.label += ` ${duplicates + 1}`;
    updateDesign(current => ({...current, shapes: [...current.shapes, shape]}));
    setSelectedShapeId(id); setSelectedVertex(null); setEditMode('vertices'); setShowShapes(true); setTool('design'); setInspectorTab('design'); setPlanningNotice('');
    returnToDrawing();
  };
  const replaceShape = shape => {
    if (!shape) return;
    updateDesign(current => ({...current, shapes: current.shapes.map(item => item.id === shape.id ? shape : item)}));
    setDraftError('');
  };
  const updateShape = (id, patch) => {
    const shape = design.shapes.find(item => item.id === id);
    const next = shape && updatePlanningShape(shape, patch);
    if (next) replaceShape(next);
    else setDraftError('No se pudo aplicar el cambio. Mantén un contorno sin cruces y medidas entre 0,01 y 200 m.');
  };
  const deleteShape = id => { clearGesture(); updateDesign(current => ({...current, shapes: current.shapes.filter(shape => shape.id !== id)})); setSelectedShapeId(null); setSelectedVertex(null); setDraftError(''); };
  const duplicateShape = id => {
    const source = design.shapes.find(shape => shape.id === id);
    if (!source || !measurementScale || design.shapes.length >= PLANNING_LIMITS.maxShapes) return;
    const newId = newShapeId();
    const offset = 0.2 / measurementScale.metresPerUnit;
    const duplicate = {...source, id: newId, label: `${source.label.slice(0, 53)} copia`, center: [source.center[0] + offset, source.center[1] + offset]};
    updateDesign(current => ({...current, shapes: [...current.shapes, duplicate]})); setSelectedShapeId(newId); setSelectedVertex(null); setShowShapes(true);
  };
  const moveShape = (xMetres, yMetres) => {
    const shape = design.shapes.find(item => item.id === selectedShapeId);
    if (!shape || !measurementScale) return;
    updateShape(shape.id, {center: [shape.center[0] + xMetres / measurementScale.metresPerUnit, shape.center[1] + yMetres / measurementScale.metresPerUnit]});
  };
  const editVertex = (action, index) => {
    const shape = design.shapes.find(item => item.id === selectedShapeId);
    if (!shape || !measurementScale || !Number.isInteger(index)) return;
    const next = action(shape, index);
    if (!next) { setDraftError('Este cambio no forma un polígono válido. Conserva al menos tres puntos y evita cruces.'); return; }
    replaceShape(next); setSelectedVertex(action === insertPlanningVertex ? index + 1 : null);
  };
  const moveSelectedVertex = (xMetres, yMetres) => {
    const shape = design.shapes.find(item => item.id === selectedShapeId);
    const handle = shape && measurementScale && planningEditHandles(shape, measurementScale.metresPerUnit, 'vertices')
      .find(item => item.kind === 'vertex' && item.index === selectedVertex);
    if (!handle) { moveShape(xMetres, yMetres); return; }
    const next = resizePlanningShape(shape, handle, [handle.point[0] + xMetres / measurementScale.metresPerUnit,
      handle.point[1] + yMetres / measurementScale.metresPerUnit], measurementScale.metresPerUnit);
    if (next) replaceShape(next); else setDraftError('El punto no puede moverse aquí: el contorno se cruza o deja de ser válido.');
  };
  const selectShape = id => { clearDraft(); setSelectedShapeId(id || null); setSelectedVertex(null); setEditMode('vertices'); setShowShapes(true); setTool('design'); };
  const chooseContour = choice => {
    const nextSelection = new Set([choice.item.id]);
    setSelected(nextSelection); setFocusedId(choice.item.id);
    setAreaModeRecord({view, selection: nextSelection, mode: 'exterior'});
    setContourResult({view, selection: nextSelection, visibleIds, choices: [],
      notice: 'Contorno exterior seleccionado. Revisa el borde naranja y abre Medidas para ver su área.'});
  };
  const startContourSelection = () => { chooseTool('contour'); returnToDrawing(); };
  const showMeasurements = () => {
    if (inspectorTab === 'measure') {
      measurementRef.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
      measurementRef.current?.focus({preventScroll: true});
    } else measurementFocusRequested.current = true;
    setInspectorTab('measure');
  };
  const openIllustration = () => {
    if (!canIllustrate) return;
    if (illustrationVisible) {
      illustrationRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
      illustrationRef.current?.focus({preventScroll: true});
    } else setIllustrationRecord({view, selection: selected, scale: measurementScale});
  };
  const eventPoint = event => { const box = event.currentTarget.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top]; };
  const nearestHandle = (point, pointerType) => {
    const radius = pointerType === 'touch' ? 18 : 10;
    return editHandles.map(handle => ({handle, distance: Math.hypot(...toScreen(handle.point, transform).map((value, index) => value - point[index]))}))
      .filter(item => item.distance <= radius).sort((a, b) => a.distance - b.distance)[0]?.handle || null;
  };
  const resizedFromGesture = (current, point, preserveAspect) => resizePlanningShape(current.shape, current.handle,
    current.handle.point.map((value, index) => value + (point[index] - current.point[index]) / current.transform.scale),
    measurementScale.metresPerUnit, {preserveAspect});
  const drawnFromGesture = (current, point, preserveAspect) => createDrawnPlanningShape(current.kind, 'drawing-preview',
    toWorld(current.point, current.transform), toWorld(point, current.transform), measurementScale.metresPerUnit,
    {role: drawingRole, label: drawingLabel(current.kind), preserveAspect});
  const startPointer = event => {
    if (![0, 1].includes(event.button)) return;
    event.currentTarget.focus({preventScroll: true});
    const point = eventPoint(event); pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {distance: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], transform};
      drag.current = null; setShapePreview(null); setDrawingPreview(null); setInvalidHandlePoint(null); setSelectedVertex(null); setSelectionBox(null); return;
    }
    const requestedMode = event.button === 1 || spacePressed.current ? 'pan' : tool;
    if (requestedMode === 'design' && measurementScale) {
      const handle = nearestHandle(point, event.pointerType);
      const shape = handle && design.shapes.find(item => item.id === selectedShapeId);
      if (shape) {
        drag.current = {point, last: point, transform, pointerId: event.pointerId, mode: 'handle', shape, handle, moved: false};
        setSelectedVertex(handle.kind === 'vertex' ? handle.index : handle.kind === 'insert' ? handle.index + 1 : null);
        setDraftError(''); setInvalidHandlePoint(null); setInspectorTab('design');
        if (handle.kind === 'insert') setShapePreview(insertPlanningVertex(shape, handle.index));
        return;
      }
    }
    const shape = requestedMode === 'design' && showShapes && measurementScale
      ? hitPlanningShape(design.shapes, toWorld(point, transform), measurementScale.metresPerUnit, 5 / transform.scale) : null;
    if (requestedMode === 'design') { setSelectedShapeId(shape?.id || null); setSelectedVertex(null); setDraftError(''); setInspectorTab('design'); }
    const mode = POINT_TOOLS.has(requestedMode) ? 'draw-points' : requestedMode.startsWith('draw-') ? 'draw-shape' : requestedMode;
    drag.current = {point, last: point, transform, pointerId: event.pointerId,
      mode: shape ? 'shape' : mode, shape, kind: requestedMode.slice(5),
      additive: multiple || event.shiftKey || event.ctrlKey || event.metaKey, moved: false};
    if (drawingTool) setDraftError('');
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
    if (!current || current.pointerId !== event.pointerId) {
      if (pointDrawing) setDraftCursor(toWorld(point, transform));
      if (tool === 'design') setHoveredHandle(nearestHandle(point, event.pointerType)?.kind || null);
      return;
    }
    current.last = point;
    if (Math.hypot(point[0] - current.point[0], point[1] - current.point[1]) > 4) current.moved = true;
    if (!current.moved) return;
    if (current.mode === 'shape') setShapePreview({...current.shape, center: [current.shape.center[0] + (point[0] - current.point[0]) / current.transform.scale,
      current.shape.center[1] + (point[1] - current.point[1]) / current.transform.scale]});
    else if (current.mode === 'handle') {
      const next = resizedFromGesture(current, point, event.shiftKey);
      setShapePreview(next); setInvalidHandlePoint(next ? null : toWorld(point, current.transform));
      setDraftError(next ? '' : 'Esta posición cruza el contorno o produce un tamaño no válido. Mueve el punto a otra posición.');
    } else if (current.mode === 'draw-shape') {
      const next = drawnFromGesture(current, point, event.shiftKey);
      setDrawingPreview(next); setDraftError(next ? '' : 'Dibuja una figura con medidas entre 0,01 y 200 m.');
    } else if (current.mode === 'rectangle') setSelectionBox(rectangle(current.point, point));
    else setTransform({...current.transform, x: current.transform.x + point[0] - current.point[0], y: current.transform.y + point[1] - current.point[1]});
  };
  const endPointer = (event, cancelled = false) => {
    pointers.current.delete(event.pointerId);
    if (pinch.current) { pinch.current = null; drag.current = null; setShapePreview(null); setDrawingPreview(null); return; }
    const current = drag.current; drag.current = null; setSelectionBox(null); setShapePreview(null); setDrawingPreview(null); setInvalidHandlePoint(null);
    if (!current || current.pointerId !== event.pointerId) return;
    if (cancelled) { if (current.mode === 'handle') setSelectedVertex(null); setDraftError(''); return; }
    const point = eventPoint(event);
    if (current.mode === 'handle') {
      if (current.moved || current.handle.kind === 'insert') {
        const next = resizedFromGesture(current, current.moved ? point : current.point, event.shiftKey);
        if (next) replaceShape(next);
        else { setSelectedVertex(null); setDraftError('El cambio no se guardó porque el contorno no es válido. La figura conserva su forma anterior.'); }
      }
      return;
    }
    if (current.mode === 'draw-shape') {
      if (current.moved) {
        const next = drawnFromGesture(current, point, event.shiftKey);
        if (next) acceptDrawnShape(next);
        else setDraftError('No se creó la figura. Dibuja un tamaño entre 0,01 y 200 m y revisa la escala.');
      }
      return;
    }
    if (current.mode === 'draw-points') {
      if (current.moved || !measurementScale) return;
      const points = draftPointsRef.current, world = toWorld(point, current.transform);
      if (tool === 'draw-polygon' && points.length >= 3 && Math.hypot(...toScreen(points[0], current.transform).map((value, i) => value - point[i])) <= (event.pointerType === 'touch' ? 18 : 12)) {
        finishDrawing(points); return;
      }
      if (points.length >= PLANNING_LIMITS.maxVertices) { setDraftError(`El polígono admite hasta ${PLANNING_LIMITS.maxVertices} puntos. Cierra el contorno o deshaz el último punto.`); return; }
      if (points.some(p => Math.hypot(p[0] - world[0], p[1] - world[1]) * measurementScale.metresPerUnit < 1e-6)) {
        setDraftError('Ese punto ya existe. Elige otra esquina o cierra en el primer punto.'); return;
      }
      const next = [...points, world];
      if (tool === 'draw-triangle' && next.length === 3) { finishDrawing(next); return; }
      draftPointsRef.current = next; setDraftPoints(next); setDraftCursor(null); setDraftError(''); return;
    }
    if (current.mode === 'shape') {
      if (current.moved) updateShape(current.shape.id, {center: [current.shape.center[0] + (point[0] - current.point[0]) / current.transform.scale,
        current.shape.center[1] + (point[1] - current.point[1]) / current.transform.scale]});
      return;
    }
    if (current.mode === 'design') return;
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
    if (event.key === 'Escape' && (drawingTool || drag.current)) {
      event.preventDefault(); event.stopPropagation(); clearDraft(); setSelectedVertex(null); if (drawingTool) setTool('design'); return;
    }
    if (editingGesture() && (event.key.startsWith('Arrow') || event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault(); return;
    }
    if (drawingTool) {
      if (event.key === 'Enter') { event.preventDefault(); if (pointDrawing) finishDrawing(); return; }
      if (event.key === 'Backspace' || event.key === 'Delete' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')) {
        event.preventDefault(); if (pointDrawing) undoDraftPoint(); return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); return; }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); historyAction(event.shiftKey ? redoDesign : undoDesign); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); historyAction(redoDesign); return; }
    if (tool === 'design' && selectedShapeId) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (editMode === 'vertices' && selectedVertex !== null) editVertex(removePlanningVertex, selectedVertex);
        else deleteShape(selectedShapeId);
        return;
      }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault(); const step = event.shiftKey ? 0.5 : 0.05;
        (editMode === 'vertices' && selectedVertex !== null ? moveSelectedVertex : moveShape)(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0); return;
      }
    }
    if (['+', '='].includes(event.key)) { event.preventDefault(); zoom(1.5); }
    else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.5); }
    else if (event.key.toLowerCase() === 'f') { event.preventDefault(); fitAll(); }
    else if (event.key === 'Escape') { setSelected(new Set()); setSelectedShapeId(null); setSelectedVertex(null); clearDraft(); }
    else if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); choose(visible.map(item => item.id), false); }
    else if (event.key.startsWith('Arrow')) {
      event.preventDefault(); const step = event.shiftKey ? 120 : 40;
      setTransform(current => ({...current, x: current.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0), y: current.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)}));
    }
  };
  const overviewClick = event => {
    if (editingGesture()) return;
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
          <button type="button" className="cad-measurements-shortcut" aria-controls={measurementPanelId} onClick={showMeasurements}>Medidas</button>
          <button type="button" onClick={() => { chooseTool('design'); openInspector('design'); }}>Figuras a escala</button>
          <button type="button" onClick={() => openInspector('footprint')}>Huella de planta</button>
          <button type="button" disabled={!canIllustrate} title={illustrationHelp} onClick={openIllustration}>Ilustración 3D</button>
          <button type="button" onClick={() => zoom(1.5)} aria-label="Acercar dibujo">＋</button>
          <button type="button" onClick={() => zoom(1 / 1.5)} aria-label="Alejar dibujo">−</button>
          <button type="button" onClick={fitAll}>Ajustar todo</button>
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
              {[['select', 'Seleccionar CAD'], ['contour', 'Área de contorno'], ['rectangle', 'Selección rectangular'], ['design', 'Mover figuras'], ['pan', 'Mover plano']].map(([value, label]) => <button key={value} type="button" aria-pressed={tool === value} onClick={() => { chooseTool(value); if (value === 'design') setInspectorTab('design'); }}>{label}</button>)}
            </div>
            <label className="cad-inline-check"><input type="checkbox" checked={multiple} disabled={tool === 'contour'} onChange={event => setMultiple(event.target.checked)} /> Acumular selección</label>
          </div>
          <div className="cad-design-toolbar"><div><span>Dibujar a escala</span>{DRAWING_TOOLS.map(([kind, label]) => <button type="button" key={kind} aria-label={`Dibujar ${label.toLocaleLowerCase('es')}`} aria-pressed={tool === `draw-${kind}`} disabled={!measurementScale || design.shapes.length >= PLANNING_LIMITS.maxShapes} onClick={() => startDrawing(kind)}>{label}</button>)}</div>
            <details className="cad-toolbar-shortcuts"><summary>Atajos</summary><div><button type="button" disabled={!measurementScale || Boolean(drawingTool) || design.shapes.length >= PLANNING_LIMITS.maxShapes} onClick={() => addShape('table')}>▭ Mesa</button><button type="button" disabled={!measurementScale || Boolean(drawingTool) || design.shapes.length >= PLANNING_LIMITS.maxShapes} onClick={() => addShape('circle')}>○ Círculo</button><button type="button" className="is-extension" disabled={!measurementScale || Boolean(drawingTool) || design.shapes.length >= PLANNING_LIMITS.maxShapes} onClick={() => addShape('extension')}>＋ Ampliación</button></div></details>
            {measurementScale ? <small>Metros reales · zoom independiente</small> : <button type="button" onClick={showMeasurements}>Confirmar escala</button>}
          </div>
          {tool === 'design' && <div className="cad-design-mode-help"><p>{editableShape ? 'Arrastra una esquina para cambiar la forma o el tamaño; arrastra el interior para mover la figura. Mayús al redimensionar conserva la proporción.' : 'Selecciona una figura para editar sus esquinas, o elige una herramienta y dibuja tu propio contorno.'}</p><button type="button" onClick={() => openInspector('design')}>Editar medidas</button></div>}
          {drawingTool && <div className="cad-sketch-instructions"><p><strong>{drawingLabel(tool.slice(5))}</strong>{pointDrawing ? tool === 'draw-triangle' ? ' · Marca tres esquinas.' : ` · ${draftPoints.length} puntos. Marca cada esquina y cierra en el primer punto.` : ' · Arrastra de una esquina a la opuesta para definir el tamaño.'}<small>Espacio + arrastrar: mover plano · Esc: cancelar{pointDrawing ? ' · Enter: terminar' : ''}</small></p><div>{pointDrawing && <button type="button" disabled={draftPoints.length < 3} onClick={() => finishDrawing()}>Terminar contorno</button>}<button type="button" onClick={cancelDrawing}>Cancelar</button></div></div>}
          {planningNotice && <p className="cad-planning-notice" role="status">{planningNotice}</p>}
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
              style={hoveredHandle ? {cursor: hoveredHandle === 'insert' ? 'copy' : hoveredHandle === 'vertex' ? 'move' : 'nwse-resize'} : undefined}
              onPointerCancel={event => endPointer(event, true)} onLostPointerCapture={event => { if (pointers.current.has(event.pointerId)) endPointer(event, true); }}
              onPointerLeave={() => { if (!drag.current) {setDraftCursor(null); setHoveredHandle(null);} }}
              onKeyDown={canvasKey} onKeyUp={event => { if (event.key === ' ') spacePressed.current = false; }} onBlur={() => { spacePressed.current = false; }} />
            <svg className="cad-sketch-overlay" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
              {editMode === 'resize' && editableShape?.kind === 'polygon' && editHandles.length === 4 && <polygon className="cad-resize-frame" points={editHandles.map(handle => toScreen(handle.point, transform).join(',')).join(' ')} />}
              {editHandles.map(handle => {
                const [x, y] = toScreen(handle.point, transform), active = handle.kind === 'vertex' && selectedVertex === handle.index;
                return <g key={handle.id} data-handle-kind={handle.kind} data-handle-index={handle.index} className={`cad-edit-handle cad-handle-${handle.kind}${active ? ' is-active' : ''}`}>
                  {handle.kind === 'insert' ? <><circle cx={x} cy={y} r="5" /><path d={`M${x - 2.5},${y}H${x + 2.5}M${x},${y - 2.5}V${y + 2.5}`} /></>
                    : handle.kind === 'resize' ? <rect x={x - 5} y={y - 5} width="10" height="10" rx="1.5" />
                      : <><circle cx={x} cy={y} r={active ? 6.5 : 5} />{active && <text x={x + 11} y={y - 10}>{handle.index + 1}</text>}</>}
                </g>;
              })}
              {pointDrawing && draftPoints.length > 0 && <g className={`cad-draft-path${draftError ? ' is-invalid' : ''}${activeSetbackCheck ? ` is-${activeSetbackCheck.status}` : ''}`}>
                <polyline points={[...draftPoints, ...(draftCursor ? [draftCursor] : [])].map(point => toScreen(point, transform).join(',')).join(' ')} />
                {draftPoints.length > 1 && <line className="cad-draft-closing" x1={toScreen(draftCursor || draftPoints.at(-1), transform)[0]} y1={toScreen(draftCursor || draftPoints.at(-1), transform)[1]} x2={toScreen(draftPoints[0], transform)[0]} y2={toScreen(draftPoints[0], transform)[1]} />}
                {draftPoints.map((point, index) => { const [x, y] = toScreen(point, transform); return <g key={index}>{index === 0 && draftPoints.length >= 3 && <circle className="cad-close-target" cx={x} cy={y} r="12" />}<circle cx={x} cy={y} r="4.5" /><text x={x + 9} y={y - 9}>{index + 1}</text></g>; })}
              </g>}
              {invalidHandlePoint && <circle className="cad-invalid-handle" cx={toScreen(invalidHandlePoint, transform)[0]} cy={toScreen(invalidHandlePoint, transform)[1]} r="8" />}
            </svg>
            {(draftMetrics || (activeSetbackCheck && tool === 'design')) && <div className={`cad-sketch-hud${activeSetbackCheck ? ` is-${activeSetbackCheck.status}` : ''}`}>
              {draftMetrics && <><span>{drawingTool ? 'Dibujo en curso' : 'Ajustando figura'}</span><strong>{formatDrawingNumber(draftMetrics.widthMetres)} × {formatDrawingNumber(draftMetrics.depthMetres)} m</strong><small>{formatDrawingNumber(draftMetrics.areaM2)} m² · perímetro {formatDrawingNumber(draftMetrics.perimeterM)} m</small></>}
              {activeSetbackCheck && <SetbackFeedback check={activeSetbackCheck} compact live={Boolean(metricPreview)}/>}
            </div>}
            {selectionBox && <div className="cad-selection-box" style={{left: selectionBox[0], top: selectionBox[1], width: selectionBox[2] - selectionBox[0], height: selectionBox[3] - selectionBox[1]}} />}
            {!visible.length && <div className="cad-empty">{drawing.items.length ? 'No hay elementos visibles con estos filtros. Activa las capas o los textos.' : 'No se recibió geometría seleccionable para esta vista. Los planos escaneados necesitan otro procesamiento.'}</div>}
            <div className="cad-overview"><button type="button" className="cad-overview-title" aria-expanded={showOverview} onClick={() => setShowOverview(value => !value)}>Vista general · {showOverview ? 'ocultar' : 'mostrar'}</button>
              {showOverview && <><div className="cad-overview-map"><canvas ref={overviewRef} onClick={overviewClick} aria-hidden="true" title="Dibujo importado: haz clic para centrar la inspección en esta zona" />
                <div className="cad-overview-viewport" style={{left: `${overviewViewport[0] / 220 * 100}%`, top: `${overviewViewport[1] / 135 * 100}%`, width: `${(overviewViewport[2] - overviewViewport[0]) / 220 * 100}%`, height: `${(overviewViewport[3] - overviewViewport[1]) / 135 * 100}%`}} />
              </div><button type="button" onClick={fitAll}>Ver todo el dibujo importado</button></>}
            </div>
            <span className="cad-zoom">{Math.round(transform.scale / fit.scale * 100)} %</span>
            {scaleBarWidth && Number.isFinite(scaleBarWidth) && <div className="cad-world-scale" aria-label={`Escala de referencia ${formatDrawingNumber(scaleBarMetres)} metros`}>{formatDrawingNumber(scaleBarMetres)} m<i style={{width: Math.max(1, scaleBarWidth)}} /></div>}
          </div>
          <p className="cad-help" id={instructionsId}>Dibuja figuras o selecciona sus puntos para editarlas. Flechas: 5 cm · Mayús + flechas: 50 cm. Rueda o dos dedos: zoom. Espacio + arrastrar: mover plano. + / − y F: ajustar vista. Ctrl/Cmd + Z: deshacer. Las listas permiten seleccionar sin usar el lienzo.</p>
          <p className="cad-source-note">La vista general y el detalle se generan con los datos importados; no son una reproducción independiente del archivo original. Las áreas, cotas y nombres escritos son anotaciones del plano, sin verificar. Los cálculos geométricos de la selección se muestran por separado en Medidas.</p>
          {!illustrationVisible && <div className="cad-illustration-entry"><p><strong>Explorar una reconstrucción ilustrativa.</strong> {illustrationHelp}</p><div className="cad-illustration-entry-actions">
            {(!exteriorChoice?.available || selectedVisible.length !== 1) && <button type="button" onClick={startContourSelection}>Elegir base de la ilustración</button>}
            {exteriorChoice?.available && !measurementScale && <button type="button" onClick={showMeasurements}>Confirmar escala</button>}
            {canIllustrate && <button type="button" onClick={openIllustration}>Crear volumen ilustrativo</button>}
          </div></div>}
          {illustrationVisible && <IllustrationBoundary onClose={() => { setIllustrationRecord(null); returnToDrawing(); }}><Suspense fallback={<p className="cad-muted" role="status">Preparando la vista ilustrativa…</p>}>
            <IllustrativeReconstruction element={selectedItems[0]} metresPerUnit={measurementScale.metresPerUnit}
              sourceViewName={[documentName, viewName(view, viewIndex)].filter(Boolean).join(' · ')} unitWarning={illustrationUnitWarning}
              sectionRef={illustrationRef}
              onReturnToDrawing={returnToDrawing} onClose={() => { setIllustrationRecord(null); returnToDrawing(); }} />
          </Suspense></IllustrationBoundary>}
          {cadLayouts.length > 0 && <details className="cad-layouts"><summary>Vistas y presentaciones del CAD ({cadLayouts.length})</summary>
            <p>{cadLayouts.map(layout => `${layout.name}${layout.displayed ? ' (disponible)' : ' (sin representación)'}`).join(' · ')}</p><p>Las presentaciones son vistas del archivo; sus nombres no confirman cuántos pisos hay.</p>
          </details>}
        </div>
        <aside className="cad-inspector" ref={inspectorRef} aria-label="Herramientas y elementos del dibujo">
          <div className="cad-studio-tabs" role="tablist" aria-label="Panel de herramientas">{INSPECTOR_TABS.map(([value, label], tabIndex) => <button type="button" key={value} id={`${instructionsId}-${value}-tab`} role="tab" tabIndex={inspectorTab === value ? 0 : -1} aria-selected={inspectorTab === value} aria-controls={`${instructionsId}-${value}-panel`} onClick={() => setInspectorTab(value)} onKeyDown={event => {
            const index = event.key === 'ArrowRight' ? (tabIndex + 1) % INSPECTOR_TABS.length : event.key === 'ArrowLeft' ? (tabIndex + INSPECTOR_TABS.length - 1) % INSPECTOR_TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? INSPECTOR_TABS.length - 1 : null;
            if (index === null) return; event.preventDefault(); setInspectorTab(INSPECTOR_TABS[index][0]); document.getElementById(`${instructionsId}-${INSPECTOR_TABS[index][0]}-tab`)?.focus();
          }}>{label}</button>)}</div>
          <div className="cad-inspector-section" id={`${instructionsId}-measure-panel`} role="tabpanel" aria-labelledby={`${instructionsId}-measure-tab`} hidden={inspectorTab !== 'measure'}>
          <MeasurementPanel key={`${viewIndex}-${view.page || 1}`} panelId={measurementPanelId} sectionRef={measurementRef}
            elements={measurementItems} hiddenSelectedCount={selectedItems.length - selectedVisible.length}
            documentFormat={documentFormat} unitsCode={unitsCode} scope={view.extraction?.scope} viewIdentity={view}
            scale={measurementScale} onScaleChange={changeScale}
            areaMode={exteriorActive ? 'exterior' : 'source'} exteriorChoice={exteriorChoice}
            onAreaModeChange={mode => setAreaModeRecord(mode === 'exterior' ? {view, selection: selected, mode} : null)}
            onChooseContour={startContourSelection} onReturnToDrawing={returnToDrawing}
            onClearSelection={() => { setSelected(new Set()); setFocusedId(null); }} />
          </div>
          <div className="cad-inspector-section" id={`${instructionsId}-design-panel`} role="tabpanel" aria-labelledby={`${instructionsId}-design-tab`} hidden={inspectorTab !== 'design'}>
            <ScaledDesignPanel shapes={shapePreview ? design.shapes.map(shape => shape.id === shapePreview.id ? shapePreview : shape) : design.shapes} selectedId={selectedShapeId} scale={measurementScale} showShapes={showShapes} onShowShapes={setShowShapes}
              onSelect={selectShape} onUpdate={updateShape} onDuplicate={duplicateShape} onDelete={deleteShape} onMove={moveShape}
              onReturn={() => { chooseTool('design'); setShowShapes(true); returnToDrawing(); }} onConfirmScale={showMeasurements} onAdd={addShape}
              history={designHistory} onUndo={() => historyAction(undoDesign)} onRedo={() => historyAction(redoDesign)}
              drawingTool={drawingTool} onStartDrawing={startDrawing} drawingPointsCount={draftPoints.length} onFinishDrawing={() => finishDrawing()}
              onUndoPoint={undoDraftPoint} onCancelDrawing={cancelDrawing} drawingRole={drawingRole} onDrawingRoleChange={setDrawingRole}
              draftMetrics={draftMetrics} draftError={draftError} setbackCheck={activeSetbackCheck} setbackLive={Boolean(metricPreview)} editMode={editMode} onEditModeChange={mode => { clearGesture(); setDraftError(''); setSelectedVertex(null); setEditMode(mode); returnToDrawing(); }}
              selectedVertex={selectedVertex} onSelectVertex={index => { setSelectedVertex(index); returnToDrawing(); }}
              onInsertVertex={index => editVertex(insertPlanningVertex, index)} onRemoveVertex={index => editVertex(removePlanningVertex, index)} />
          </div>
          <div className="cad-inspector-section" id={`${instructionsId}-footprint-panel`} role="tabpanel" aria-labelledby={`${instructionsId}-footprint-tab`} hidden={inspectorTab !== 'footprint'}>
            <GroundFootprintPanel choice={footprintChoice} selectedElement={selectedFootprintElement} footprint={activeFootprint} scale={measurementScale}
              onUse={footprint => { updateDesign(current => ({...current, footprint})); setPlanningNotice('Huella extraída. Continúa en Implantación y ampliación debajo del visor para ubicarla sobre un predio.'); }}
              onClear={() => updateDesign(current => ({...current, footprint: null}))} onChoose={startContourSelection} onConfirmScale={showMeasurements} />
          </div>
          <div className="cad-inspector-section" id={`${instructionsId}-layers-panel`} role="tabpanel" aria-labelledby={`${instructionsId}-layers-tab`} hidden={inspectorTab !== 'layers'}>
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
          </div>
        </aside>
      </div>
    </section>
  );
}
