const WORK_ACTIVITIES = {
  repair: [['repair_wall','Reparar muro'],['repair_floor','Reparar piso'],['repair_roof','Reparar techo'],['repair_leak','Reparar filtración']],
  maintenance: [['paint_walls','Pintar paredes'],['paint_ceiling','Pintar techo'],['waterproof','Impermeabilizar'],['renew_finishes','Renovar acabados']],
  remodel: [['replace_floor','Cambiar acabado de piso'],['remodel_bathroom','Remodelar baño'],['remodel_kitchen','Remodelar cocina'],['change_layout','Cambiar distribución']],
  structural: [['modify_structural_wall','Modificar muro estructural'],['modify_slab','Modificar losa']],
  expansion: [['expand_room','Ampliar habitación'],['new_space','Construir nuevo espacio'],['add_floor','Añadir piso']],
};

import React, { useEffect, useState } from 'react';
import ParcelMap from './components/ParcelMap.jsx';
import BlueprintViewer from './components/BlueprintViewer.jsx';
import ProjectPackagePanel from './components/ProjectPackagePanel.jsx';
import DrawingLocationPanel from './components/DrawingLocationPanel.jsx';
import FootprintPlanner from './components/FootprintPlanner.jsx';
import ResidentialSimulator from './ResidentialSimulator.jsx';
import ProductOverview from './components/ProductOverview.jsx';
import SelectionPage from './components/SelectionPage.jsx';
import AnalyticsRoadmap from './components/AnalyticsRoadmap.jsx';
import { SELECTION_KEY, SELECTION_LIMIT, parseSelection, selectionRecord, mergeSelection } from './selection.js';
import { workspaceForPage, requiresIrm, documentValidationError, isProjectPackage, inspectionTimeoutMs, createInspectionForm } from './documentWorkflow.js';
import { hasPartialExtraction, dwgConversionNotice } from './drawingExtraction.js';
import { createExampleDrawing } from './exampleDrawing.js';
import './styles/planning-studio.css';

const ROUTES = { inicio: 'home', explorar: 'explore', predio: 'property', planos: 'blueprints', seleccion: 'selection', analitica: 'analytics' };
const pageFromHash = () => ROUTES[window.location.hash.slice(1)] || 'home';
const routeForPage = page => Object.keys(ROUTES).find(key => ROUTES[key] === page) || 'inicio';
const scrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const EMPTY_LOCATION_REFERENCES = Object.freeze({});
const EMPTY_PLANNING_RECORD = Object.freeze({draft: null, snapshot: null, placement: null});
function updatePlanningRecord(records, drawing, field, value) {
  if (!drawing) return records;
  const previous = records.find(record => record.drawing === drawing) || EMPTY_PLANNING_RECORD;
  if (previous[field] === value) return records;
  return [...records.filter(record => record.drawing !== drawing), {...previous, drawing, [field]: value}].slice(-6);
}

// ============================================================
// 1. CONFIGURATION
// ============================================================

const API =
  import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Optional valuation display helpers. Values remain cadastral, not market prices.
// Explanations of cadastral concepts. The AVALUO_C_1..6 labels are inferred
// by matching their amounts to the municipal certificate; not official API aliases.
const valuationHelp = {
  avaluo_ter: 'Valor catastral del suelo atribuido al predio. En propiedad horizontal corresponde a la participación de la unidad, no al valor íntegro del lote matriz.',
  avaluo_con: 'Valor de las construcciones cubiertas de la unidad según el catastro. No equivale necesariamente al costo de reposición ni al precio comercial.',
  avaluo_c_1: 'Valor de construcciones registradas como abiertas, como ciertas terrazas, patios construidos u otras áreas sin cerramiento completo. La categoría específica depende de la ficha municipal.',
  avaluo_c_2: 'Valor de instalaciones especiales que el municipio registra y valora por separado de las construcciones ordinarias.',
  avaluo_c_3: 'Parte del valor de las construcciones comunales cubiertas atribuida a esta unidad según su alícuota de propiedad horizontal.',
  avaluo_c_4: 'Parte del valor de las construcciones comunales abiertas atribuida a esta unidad según su alícuota.',
  avaluo_c_5: 'Parte proporcional de elementos o mejoras constructivas comunales adicionales que el catastro valora por separado.',
  avaluo_c_6: 'Componente de valoración comunal registrado bajo una categoría especial. Su alcance técnico exacto requiere confirmación municipal.',
  avaluo_tot: 'Avalúo catastral total registrado para el inmueble, no una estimación de su precio de venta.',
  land_rate: 'Indicador calculado: avalúo del terreno dividido para el área de terreno atribuida a la unidad. No es el valor oficial AIVA por m².',
  construction_rate: 'Indicador calculado: avalúo de construcciones cubiertas dividido para el área bruta total registrada. No es una tarifa municipal oficial por m².'
};
const ValuationTerm = ({label, helpKey}) => <details className="valuation-help"><summary>{label} <span aria-hidden="true">ⓘ</span></summary><p>{valuationHelp[helpKey]}</p></details>;

const formatUSD = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : 'No disponible';

const formatRate = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${formatUSD(value)}/m²`
    : 'No disponible';

const formatMunicipalDate = (value) => {
  if (value == null || value === '') return 'No disponible';
  const timestamp = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(value);
  return Number.isNaN(date.getTime()) ? 'No disponible' : date.toLocaleDateString('es-EC', {timeZone:'UTC', year:'numeric', month:'2-digit', day:'2-digit'});
};

const formatArea = (value) =>
  typeof value === 'number'
    ? `${value.toLocaleString('es-EC', {
        maximumFractionDigits: 2
      })} m²`
    : 'No disponible';

// ============================================================
// 2. MAIN APPLICATION
// ============================================================

export default function App() {

  const [page, setPage] = useState(pageFromHash);
  const [step, setStep] = useState(() => workspaceForPage(pageFromHash()).step);
  const [audience, setAudience] = useState(() => workspaceForPage(pageFromHash()).audience);
  const [savedParcels, setSavedParcels] = useState(() => {
    try { return parseSelection(localStorage.getItem(SELECTION_KEY)); } catch { return []; }
  });
  const [selectionNotice, setSelectionNotice] = useState('');
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [slowLookup, setSlowLookup] = useState(false);
  const individualController = React.useRef(null);
  const individualRunId = React.useRef(0);
  const exploreRunId = React.useRef(0);
  const irmRunId = React.useRef(0);
  const isWorkspace = page === 'explore' || page === 'property' || page === 'blueprints';

  function navigate(next) {
    if (next === page) return;
    individualController.current?.abort();
    individualRunId.current++;
    setLoading(false);
    setError('');
    setPage(next);
    const workspace = workspaceForPage(next);
    setAudience(workspace.audience); setStep(workspace.step);
    window.location.hash = routeForPage(next);
  }

  useEffect(() => {
    const onHashChange = () => {
      const next = pageFromHash();
      individualController.current?.abort(); individualRunId.current++; setLoading(false); setSlowLookup(false);
      setPage(next);
      const workspace = workspaceForPage(next);
      setAudience(workspace.audience); setStep(workspace.step);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const titles = { home: 'Entiende tus planos. Prepara tu reforma.', explore: 'Explorar predios', property: 'Mi predio', blueprints: 'Analizar planos', selection: 'Mi selección', analytics: 'Próxima etapa: analítica' };
    document.title = `PredioAI | ${titles[page]}`;
    window.scrollTo({top: 0, behavior: 'auto'});
    document.getElementById('main-content')?.focus({preventScroll: true});
  }, [page, step]);

  useEffect(() => {
    try { localStorage.setItem(SELECTION_KEY, JSON.stringify(savedParcels)); setStorageAvailable(true); }
    catch { setStorageAvailable(false); }
  }, [savedParcels]);

  function saveParcel(parcel) {
    const record = selectionRecord(parcel);
    if (!record) return;
    if (savedParcels.some(item => item.n_predio === record.n_predio)) {
      setSelectionNotice(`El predio ${record.n_predio} ya está en tu selección.`); return;
    }
    if (savedParcels.length >= SELECTION_LIMIT) {
      setSelectionNotice(`Tu cartera tiene ${SELECTION_LIMIT} predios. Quita uno desde Selección para agregar otro.`); return;
    }
    setSavedParcels(current => [...current, record]);
    setSelectionNotice(`Predio ${record.n_predio} guardado. Revísalo en Selección.`);
  }
  function importParcels(items) {
    const result = mergeSelection(savedParcels, items);
    setSavedParcels(result.records);
    setSelectionNotice(`${result.added} predios importados a la cartera.`);
    return result;
  }
  function setIrmReviewStatus(id, reviewed) {
    setSavedParcels(current => current.map(p => p.n_predio === String(id)
      ? { ...p, irmReview: reviewed ? 'manual_reviewed' : 'pending' } : p));
  }
  async function enrichImportedPredios(ids, onProgress = () => {}) {
    const requested = [...new Set(ids.map(String))].filter(id => /^\d{1,25}$/.test(id)).slice(0, 10);
    const found = new Map();
    const failed = [];
    for (let i = 0; i < requested.length; i++) {
      const id = requested[i];
      onProgress(`Consultando ficha municipal ${i + 1} de ${requested.length} · predio ${id}`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        let response;
        try { response = await fetch(`${API}/api/predios/n_predio/${encodeURIComponent(id)}`, {signal: controller.signal}); }
        finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        const attrs = body?.features?.[0]?.properties;
        if (!attrs || String(attrs.n_predio) !== id) throw new Error('Identificador no confirmado');
        found.set(id, attrs);
      } catch (error) { failed.push(id); }
    }
    if (found.size) setSavedParcels(current => current.map(record => {
      const attrs = found.get(record.n_predio);
      return attrs ? selectionRecord({ ...record, ...attrs, n_predio: record.n_predio,
        source: 'catastro', irmReview: record.irmReview }, record.savedAt) : record;
    }));
    onProgress('');
    return {updated: found.size, failed: failed.length, failedIds: failed};
  }
  const [developerIrm, setDeveloperIrm] = useState(null);
  const [irmExtraction, setIrmExtraction] = useState(null);
  const [irmExtracting, setIrmExtracting] = useState(false);
  const [irmExtractError, setIrmExtractError] = useState('');
  const [irmConfirmed, setIrmConfirmed] = useState(false);
  const [developmentType, setDevelopmentType] = useState('single');
  const [landGoal, setLandGoal] = useState('individual');
  const [searchLandClass,setSearchLandClass]=useState('all');
  const [searchAreaMin,setSearchAreaMin]=useState('500');
  const [searchAreaMax,setSearchAreaMax]=useState('6000');
  const [constructionRatioMax,setConstructionRatioMax]=useState('');
  const [minimumFrontage,setMinimumFrontage]=useState('');
  const [administrativeZone,setAdministrativeZone]=useState('all');
  const [administrativeZoneOptions,setAdministrativeZoneOptions]=useState([]);
  const [administrativeZoneError,setAdministrativeZoneError]=useState('');
  const [ownershipRegime,setOwnershipRegime]=useState('all');
  const [ownershipRegimeOptions,setOwnershipRegimeOptions]=useState([]);
  const [ownershipRegimeError,setOwnershipRegimeError]=useState('');
  const [searchParishes,setSearchParishes]=useState([]);
  const [exploreResults,setExploreResults]=useState([]);
  const [exploreSort,setExploreSort]=useState('id');
  const [reelColumns,setReelColumns]=useState(1);
  const [listPageSize,setListPageSize]=useState(50);
  const [iconPageSize,setIconPageSize]=useState(100);
  const [detailsCollapsed,setDetailsCollapsed]=useState(false);
  const [resultsCollapsed,setResultsCollapsed]=useState(false);
  const [detailsWidth,setDetailsWidth]=useState(420);
  const [resultsWidth,setResultsWidth]=useState(410);
  const [exploreGeometries,setExploreGeometries]=useState(null);
  const [exploreAllGeometries,setExploreAllGeometries]=useState(null);
  const [exploreAllOrder,setExploreAllOrder]=useState([]);
  const [exploreMapNotice,setExploreMapNotice]=useState('');
  const [exploreSelected,setExploreSelected]=useState(null);
  const toggleExplorePredio=id=>setExploreSelected(current=>current===String(id)?null:String(id));
  const selectExplorePredioFromMap=id=>{
    const selectedId=String(id);
    setResultsCollapsed(false);
    setExploreSelected(selectedId);
    const position=exploreAllOrder.indexOf(selectedId);
    if(position>=0 && !exploreBusy && exploreQueryKey===explorationFilterKey){
      const targetOffset=Math.floor(position/explorePageSize)*explorePageSize;
      if(targetOffset!==exploreOffset)exploreParcels(targetOffset,exploreSort,explorePageSize,true);
    }
  };
  // Keep GIS map selection and the matching result card synchronized.
  useEffect(()=>{
    if(!exploreSelected || !exploreResults.length)return;
    const reel=document.getElementById('predio-results-reel');
    if(!reel)return;
    const card=Array.from(reel.querySelectorAll('[data-predio-id]'))
      .find(element=>element.dataset.predioId===String(exploreSelected));
    if(!card)return;
    // Scroll only the sidebar's card list, never the entire page/map.
    const top=card.getBoundingClientRect().top-reel.getBoundingClientRect().top+reel.scrollTop;
    reel.scrollTo({top:Math.max(0,top-reel.clientHeight/3),behavior:scrollBehavior()});
  },[exploreSelected,exploreResults,reelColumns]);

  const [exploreCount,setExploreCount]=useState(null);
  const [exploreBusy,setExploreBusy]=useState(false);
  const [exploreError,setExploreError]=useState('');
  const [exploreOffset,setExploreOffset]=useState(0);
  const [exploreQueryKey,setExploreQueryKey]=useState('');
  const [exploreSearchOpen,setExploreSearchOpen]=useState(true);
  const [exploreOptionalOpen,setExploreOptionalOpen]=useState(false);
  const [advancedRows,setAdvancedRows]=useState({});
  const [advancedBusy,setAdvancedBusy]=useState(false);
  const [advancedProgress,setAdvancedProgress]=useState('');
  const [advancedError,setAdvancedError]=useState('');
  const [advancedFilter,setAdvancedFilter]=useState('all');
  const [advancedOpen,setAdvancedOpen]=useState(false);
  const advancedRunId=React.useRef(0);
  const [pugsData, setPugsData] = useState(null);
  const [pugsLoading, setPugsLoading] = useState(false);
  const [pugsError, setPugsError] = useState('');
  const [irmValues, setIrmValues] = useState({ area: '', cosPb: '', cosTotal: '', floors: '', minLot: '', minFront: '', dwellingCode: '' });
  const [developerAreaSource, setDeveloperAreaSource] = useState('');
  const showSubdivision = ['multiple', 'subdivision'].includes(developmentType);
  const showHousingCode = developmentType !== 'subdivision';
  // Search state
  const [identifier, setIdentifier] = useState('');
  const [identifierType, setIdentifierType] =
    useState('n_predio');

  // Property data
  const [data, setData] = useState(null);
  const cadastralProperties = data?.features?.[0]?.properties;
  const isCadastralPH = String(cadastralProperties?.tipo_propi || '').trim().toUpperCase() === 'PROPIEDAD HORIZONTAL';
  const attributedArea = Number(cadastralProperties?.area_ter_1);
  const parentLotArea = Number(cadastralProperties?.area_terre);
  // Never substitute the parent-lot area for an individual PH predio.
  const cadastralArea = isCadastralPH ? attributedArea : parentLotArea;
  const cadastralAreaValue = Number.isFinite(cadastralArea) && cadastralArea > 0 ? String(cadastralArea) : '';
  const cadastralAreaLabel = isCadastralPH ? 'área atribuida al predio PH' : 'área catastral del predio';
  const pugsZones = pugsData?.zones || [];
  const dominantZone = pugsData?.dominant_zone || (pugsData?.status === 'single_zone' ? pugsZones[0] : null);
  // Preserve the authoritative zoning identifier separately from its display label.
  const pugsCode = dominantZone?.tipologia || null;
  const pugsUse = dominantZone?.tipo_des || dominantZone?.leyenda || dominantZone?.uso_prin || null;
  const pugsDescription = zone => {
    const raw = String(zone?.tipo_des || zone?.leyenda || zone?.uso_prin || 'Clasificación no disponible');
    return raw.replace(/\s*(?:tipo\s*\d+|[-–]\s*\d+)\s*$/i, '').trim();
  };
  const dominantOverlap = Number(dominantZone?._overlap_percent);
  const hasMeasuredOverlap = dominantZone?._overlap_percent != null && Number.isFinite(dominantOverlap);
  const singleZoningClassification = pugsZones.length === 1 || (hasMeasuredOverlap && dominantOverlap > 90);
  const zoningClassifications = singleZoningClassification && dominantZone ? [dominantZone] : pugsZones;

  // Distinguish baseline building parameters from use permission and protected areas.
  const isProtectedZone = zone => {
    const code = String(zone?.tipologia || zone?.uso_prin || '').toUpperCase();
    const description = String([zone?.tipo_des, zone?.leyenda, zone?.uso_prin].filter(Boolean).join(' ')).toLowerCase();
    return code === 'PE' || /protecci[oó]n ecol[oó]gica|protecci[oó]n ambiental|conservaci[oó]n/.test(description);
  };
  const protectedZones = pugsZones.filter(isProtectedZone);
  const buildingZones = pugsZones.filter(zone => !isProtectedZone(zone));
  // A single source-ordered image list prevents the occupation diagram from
  // floating above earlier IRM maps in a separate render block.
  const irmImages = [
    ...(irmExtraction?.evidence || []),
    ...(irmExtraction?.occupationDiagram ? [{
      ...irmExtraction.occupationDiagram,
      key: 'occupation_diagram',
      imageOrder: irmExtraction.occupationDiagram.imageOrder ?? (irmExtraction.occupationDiagram.imagePage * 1000000 + 999000),
      title: 'Esquema de implantación y retiros'
    }] : [])
  ].sort((a,b) => (a.imageOrder ?? (a.imagePage || 9999)*1000000) -
                   (b.imageOrder ?? (b.imagePage || 9999)*1000000));
  const irmPugsAssignments = irmExtraction?.pugsAssignments || [];
  const irmHasLandUse = irmPugsAssignments.length > 0;
  const irmHasSetbacks = ['retiro_frontal','retiro_lateral','retiro_posterior']
    .every(key => irmExtraction?.candidate_irm_fields?.[key]?.raw);
  const irmHasFrontage = Boolean(irmExtraction?.candidate_irm_fields?.frente_minimo?.raw);
  const irmHasMultipleZoning = irmPugsAssignments.length > 1;
  const irmRestrictions = irmExtraction?.evidence || [];
  const ravineRestriction = irmRestrictions.some(item => item.key === 'quebrada');
  const forestRestriction = irmRestrictions.some(item => item.key === 'forestal');
  const basicBuildability = buildingZones.map(zone => ({
    code: zone.cod_edi_ba || null,
    designation: zone.edifi_ba || null,
    minLot: zone.lot_min_ba,
    floors: zone.pisos_ba,
    cosPb: zone.cos_pb_ba,
    overlap: zone._overlap_percent,
    label: [zone.uso_prin, zone.leyenda].filter(Boolean).join(' - ')
  }));
  const isSubdivisionRequest = developmentType === 'subdivision' || developmentType === 'multiple';
  const isMultifamilyRequest = developmentType === 'apartments';
  // A PUGS density label is not a verified residential use-permission matrix.
  const projectPermission = type => {
    const value = pugsData?.use_permissions?.[type];
    return irmExtraction && pugsData?.use_permissions_verified === true &&
      pugsData?.status === 'single_zone' &&
      ['permitted', 'prohibited', 'conditional'].includes(value) ? value : null;
  };
  const permissionLabels = { permitted: 'Permitido por zonificación', prohibited: 'No permitido por zonificación', conditional: 'Permitido con condiciones' };
  const projectCompatibility = !irmExtraction ? 'Pendiente de cargar el IRM'
    : permissionLabels[projectPermission(developmentType)] || 'Pendiente de verificar usos permitidos';
  const parcelFeasibility = !irmExtraction ? 'Pendiente de cargar el IRM'
    : isCadastralPH ? 'Revisión de propiedad horizontal requerida'
    : isSubdivisionRequest && Number(irmValues.area) > 0 && Number(irmValues.minLot) > 0 && Number(irmValues.area) < Number(irmValues.minLot)
      ? 'Superficie insuficiente para un nuevo lote mínimo'
      : 'Factibilidad sujeta a retiros, uso y permisos';
  const capacityReady = (!isCadastralPH || Boolean(irmExtraction?.candidate_irm_fields?.area_terreno)) && Number(irmValues.area) > 0 && irmValues.cosPb !== '' && Number(irmValues.cosPb) >= 0 && Number(irmValues.cosPb) <= 100 && irmValues.cosTotal !== '' && Number(irmValues.cosTotal) >= 0 && Number.isInteger(Number(irmValues.floors)) && Number(irmValues.floors) > 0;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Drawing or project-package inspection. Keep the ZIP File for subsequent entries.
  const [pdf, setPdf] = useState(null);
  const [irmPdf, setIrmPdf] = useState(null);
  // OPTIONAL WORKFLOW SELECTORS — BEGIN
  const [buildingType, setBuildingType] = useState('house');
  const [workType, setWorkType] = useState('repair');
  const [activities, setActivities] = useState(['repair_wall']);
  // These are document-inspection requirements, not a municipal permit decision.
  const irmRequired = requiresIrm(workType, activities);
  // OPTIONAL WORKFLOW SELECTORS — END
  const [irmCopyStatus, setIrmCopyStatus] = useState('');
  const [irmBridgeBusy, setIrmBridgeBusy] = useState(false);
  const [inspection, setInspection] = useState(null);
  // Reference coordinates belong to this exact inspection, including its ZIP member.
  const [locationRecord, setLocationRecord] = useState(null);
  const locationReferences = locationRecord?.inspection === inspection
    ? locationRecord.value : EMPTY_LOCATION_REFERENCES;
  const [drawingExample, setDrawingExample] = useState(null);
  const [packageRecord, setPackageRecord] = useState(null);
  const activePackage = packageRecord?.file === pdf ? packageRecord.manifest : null;
  const [pendingPackageEntry, setPendingPackageEntry] = useState(null);
  const selectedDocumentError = inspection?.blueprint?.inspection_error || '';
  const displayedDrawing = drawingExample || (!selectedDocumentError ? inspection?.blueprint : null);
  const [planningRecords, setPlanningRecords] = useState([]);
  const currentPlanning = planningRecords.find(record => record.drawing === displayedDrawing) || EMPTY_PLANNING_RECORD;
  const reportPlanning = planningRecords.find(record => record.drawing === inspection?.blueprint) || EMPTY_PLANNING_RECORD;
  const savePlanningDraft = React.useCallback(draft => setPlanningRecords(records =>
    updatePlanningRecord(records, displayedDrawing, 'draft', draft)), [displayedDrawing]);
  const savePlanningSnapshot = React.useCallback(snapshot => setPlanningRecords(records =>
    updatePlanningRecord(records, displayedDrawing, 'snapshot', snapshot)), [displayedDrawing]);
  const savePlanningPlacement = React.useCallback(placement => setPlanningRecords(records =>
    updatePlanningRecord(records, displayedDrawing, 'placement', placement)), [displayedDrawing]);
  const [projectSetupOpen, setProjectSetupOpen] = useState(true);
  const [inspectedIrmFile, setInspectedIrmFile] = useState(null);
  const [attachingIrm, setAttachingIrm] = useState(false);
  const [irmAttachNotice, setIrmAttachNotice] = useState('');
  const irmAttachController = React.useRef(null);
  const irmAttachRunId = React.useRef(0);
  const irmPending = Boolean(inspection && irmPdf && irmPdf !== inspectedIrmFile);
  const blueprintConversion = selectedDocumentError ? null : dwgConversionNotice(inspection?.blueprint);
  const [inspecting, setInspecting] = useState(false);
  const [inspectionError, setInspectionError] = useState('');
  const [documentInputVersion, setDocumentInputVersion] = useState(0);
  const inspectionController = React.useRef(null);
  const inspectionRunId = React.useRef(0);
  const lastDocumentPredio = React.useRef(null);

  // A late response must never attach an old drawing to a changed project.
  useEffect(() => {
    inspectionController.current?.abort();
    inspectionRunId.current++;
    setInspecting(false);
    setPendingPackageEntry(null);
    return () => inspectionController.current?.abort();
  }, [pdf, irmPdf, buildingType, workType, activities, data, page]);

  useEffect(() => {
    irmAttachController.current?.abort();
    irmAttachRunId.current++;
    setAttachingIrm(false);
    return () => irmAttachController.current?.abort();
  }, [pdf, irmPdf, data, page]);

  useEffect(() => {
    const nextPredio = String(data?.features?.[0]?.properties?.n_predio || '');
    if (!nextPredio) return;
    const previousPredio = lastDocumentPredio.current;
    lastDocumentPredio.current = nextPredio;
    if (previousPredio && previousPredio !== nextPredio) {
      setPdf(null); setIrmPdf(null); setInspection(null); setPackageRecord(null); setDrawingExample(null);
      setDocumentInputVersion(version => version + 1);
      setInspectionError('Cambiaste de predio. Adjunta los documentos que correspondan a la nueva propiedad.');
    }
  }, [data]);

  function selectDocument(event, role) {
    const file = event.target.files?.[0] || null;
    const validationError = documentValidationError(file, role);
    inspectionController.current?.abort();
    inspectionRunId.current++;
    setInspecting(false);
    setPendingPackageEntry(null);
    setProjectSetupOpen(true);
    setIrmAttachNotice('');
    if (role === 'irm') {
      setIrmPdf(validationError ? null : file);
      // Replacing only the IRM must not discard a scaled layout or a footprint.
      // Remove previous IRM evidence immediately; the new file needs inspection.
      setInspection(current => current ? {...current, irm: null} : null);
      setInspectedIrmFile(null);
    }
    else {
      setPdf(validationError ? null : file);
      setPackageRecord(null);
      setInspection(null);
    }
    setDrawingExample(null);
    setInspectionError(validationError);
    if (validationError) event.target.value = '';
  }

  async function attachIrmToDrawing() {
    if (!irmPdf || !inspection?.blueprint || attachingIrm) return;
    const sourceDrawing = inspection.blueprint;
    const sourceFile = irmPdf;
    irmAttachController.current?.abort();
    const controller = new AbortController();
    irmAttachController.current = controller;
    const runId = ++irmAttachRunId.current;
    const timeout = setTimeout(() => controller.abort(), 90000);
    setAttachingIrm(true); setIrmAttachNotice('');
    try {
      const form = new FormData(); form.append('file', sourceFile);
      const response = await fetch(`${API}/api/irm/extract`, {method: 'POST', body: form, signal: controller.signal});
      const result = await response.json();
      if (runId !== irmAttachRunId.current) return;
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'No se pudo leer el IRM. Revisa el archivo e inténtalo de nuevo.');
      const irm = {...result, format: 'pdf', pages: Array.isArray(result.pages) ? result.pages : Array.from({length: Math.min(1000, Math.max(0, Number(result.pages) || 0))}, (_, index) => ({page: index + 1}))};
      setInspection(current => current?.blueprint === sourceDrawing ? {...current, irm} : current);
      setInspectedIrmFile(sourceFile);
      setIrmAttachNotice('IRM incorporado. Tu plano, figuras y huella se conservan; revisa la correspondencia con el predio.');
    } catch (error) {
      if (runId !== irmAttachRunId.current) return;
      setIrmAttachNotice(controller.signal.aborted ? 'La lectura del IRM tardó más de lo previsto. Inténtalo de nuevo.' : error.message || 'No se pudo incorporar el IRM.');
    } finally {
      clearTimeout(timeout);
      if (runId === irmAttachRunId.current) setAttachingIrm(false);
    }
  }

  function updateDrawingActivity(nextType, nextActivities, nextBuilding = buildingType) {
    setWorkType(nextType); setActivities(nextActivities); setBuildingType(nextBuilding);
    setInspectionError('');
    setInspection(current => current ? {...current, work_type: nextType, building_type: nextBuilding,
      activities: nextActivities.map(id => ({id, label: WORK_ACTIVITIES[nextType].find(activity => activity[0] === id)?.[1] || id}))} : current);
  }

  // Copy the known predio number and open the official portal on a user click.
  // Browsers cannot prefill a separate site's form; CAPTCHA stays manual.
  async function startIrmDesktop() {
    const predio = String(properties?.n_predio || properties?.predio || '').trim();
    if (!/^\d{1,25}$/.test(predio)) {
      setIrmCopyStatus('No se encontró un número de predio válido.');
      return;
    }
    setIrmBridgeBusy(true);
    setIrmCopyStatus('Conectando con Playwright en su computadora…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('http://127.0.0.1:8765/irm/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ predio }),
        signal: controller.signal
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'El puente local no respondió correctamente.');
      setIrmCopyStatus('Playwright iniciado para el predio ' + predio + '. Complete el CAPTCHA en la ventana Chromium que se abrió.');
    } catch (error) {
      setIrmCopyStatus('No se pudo conectar con Playwright local. Inicie «py automation/irm_bridge.py» en su computadora y vuelva a intentar. También puede usar «Copiar número» y abrir el portal manualmente. Detalle: ' + (error?.message || 'conexión bloqueada'));
    } finally {
      clearTimeout(timeout);
      setIrmBridgeBusy(false);
    }
  }

  async function copyIrmPredio() {
    const number = String(properties?.n_predio || properties?.predio || '').trim();
    if (!number) {
      setIrmCopyStatus('No se encontró un número de predio para copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(number);
      setIrmCopyStatus(`Copiado: ${number}. Abra el portal y péguelo en «Número de Predio».`);
    } catch {
      // Clipboard permissions vary across Safari/iOS and embedded browsers.
      // Keep the value selectable rather than claiming it was copied.
      setIrmCopyStatus(`No se pudo copiar automáticamente. Mantenga pulsado el número ${number} para copiarlo.`);
    }
  }

  async function uploadDeveloperIrm(file) {
    const runId = ++irmRunId.current;
    setDeveloperIrm(file);
    setIrmExtraction(null);
    setIrmExtractError('');
    setIrmConfirmed(false);
    setIrmValues({ area: cadastralAreaValue, cosPb: '', cosTotal: '', floors: '', minLot: '', minFront: '', dwellingCode: '' });
    setDeveloperAreaSource(cadastralAreaValue ? `Fuente: Catastro municipal, ${cadastralAreaLabel}; contrastar con el IRM. No representa automáticamente superficie edificable.` : 'Área específica no disponible; no se usará el área del lote matriz como sustituto.');
    if (!file) return;
    setIrmExtracting(true);
    try {
      // GitHub Pages is static: parse locally instead of calling localhost:8000.
      // The PDF never leaves the user's browser.
      const { inspectIrmInBrowser } = await import('./irmBrowser.js');
      const body = await inspectIrmInBrowser(file);
      if (runId !== irmRunId.current) return;
      const fields = body.candidate_irm_fields || {};
      const parsed = key => fields[key]?.raw?.replace(',', '.') || '';
      const selectedPredio = String(properties?.n_predio || '').trim();
      const extractedPredio = parsed('predio');
      if (selectedPredio && extractedPredio && selectedPredio !== extractedPredio) {
        throw new Error('El número de predio del IRM no coincide con el predio seleccionado. Revise el documento.');
      }
      setIrmExtraction(body);
      // IRM "Área según escritura" describes the global lot for PH properties.
      // Never overwrite the individually attributed cadastral area with that value.
      const irmArea = parsed('area_terreno');
      const selectedArea = isCadastralPH ? cadastralAreaValue : (irmArea || cadastralAreaValue);
      setIrmValues({ area: selectedArea, cosPb: parsed('cos_pb'), cosTotal: parsed('cos_total'), floors: parsed('pisos'), minLot: parsed('lote_minimo'), minFront: parsed('frente_minimo'), dwellingCode: parsed('vivienda_tipo') });
      setDeveloperAreaSource(isCadastralPH
        ? (cadastralAreaValue
          ? 'Fuente: Catastro municipal, superficie atribuida al predio en propiedad horizontal (area_ter_1). El área según escritura del IRM corresponde al lote matriz y no se utiliza como área individual.'
          : 'No se dispone de superficie individual verificada para este predio PH. No se sustituye por el área del lote matriz.')
        : fields.area_terreno ? 'Fuente: IRM aportado (extracción automática, sin verificar).' : cadastralAreaValue ? `Fuente: Catastro municipal (${cadastralAreaLabel}); el IRM no contenía un área reconocible.` : 'Área del predio no disponible en las fuentes.');
    } catch (err) {
      if (runId === irmRunId.current) setIrmExtractError(err?.message || "No se pudo procesar el PDF. Compruebe el formato e inténtelo de nuevo.");
    } finally {
      if (runId === irmRunId.current) setIrmExtracting(false);
    }
  }

  // IRM files and extracted values are intentionally ephemeral.
  // Reloading the page starts with no uploaded PDF or restored IRM extraction.
  useEffect(() => {
    irmRunId.current++; setIrmExtracting(false);
    setDeveloperIrm(null);
    setIrmConfirmed(false);
    setIrmExtraction(null);
    setIrmValues({ area: cadastralAreaValue, cosPb: '', cosTotal: '', floors: '', minLot: '', minFront: '', dwellingCode: '' });
    setDeveloperAreaSource(cadastralAreaValue ? `Fuente: Catastro municipal (${cadastralAreaLabel}); pendiente de contraste con el IRM.` : 'Área específica no disponible; no se utiliza el lote matriz.');
    try {
      Object.keys(sessionStorage).filter(key => key.startsWith('predioai-irm-')).forEach(key => sessionStorage.removeItem(key));
    } catch { /* browser storage may be unavailable */ }
  }, [data]);

  useEffect(() => {
    const predio = String(data?.features?.[0]?.properties?.n_predio || '').trim();
    setPugsData(null);
    setPugsError('');
    setPugsLoading(false);
    if (!predio || audience !== 'developer') return;
    const controller = new AbortController();
    setPugsLoading(true);
    fetch(`${API}/api/pugs/n_predio/${encodeURIComponent(predio)}`, {signal: controller.signal})
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Consulta PUGS no disponible');
        return body;
      })
      .then(setPugsData)
      .catch(error => { if (error.name !== 'AbortError') setPugsError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setPugsLoading(false); });
    return () => controller.abort();
  }, [data, audience]);

  // Municipal property attributes
  const properties = data?.features?.[0]?.properties;
  const planningParcel = drawingExample ? null : data;
  const planningIrm = drawingExample ? null : inspection?.irm;
  const saveSetbackReview = React.useCallback(review => setPlanningRecords(records =>
    updatePlanningRecord(records, displayedDrawing, 'setbackReview', {review, parcel: planningParcel, irm: planningIrm})),
  [displayedDrawing, planningParcel, planningIrm]);
  // A review belongs to the linked parcel and document as well as the CAD source.
  // A document/parcel switch must not briefly reuse the previous project's colors.
  const currentSetbackReview = currentPlanning.setbackReview?.parcel === planningParcel
    && currentPlanning.setbackReview?.irm === planningIrm ? currentPlanning.setbackReview.review : null;

  // Cadastral facts are descriptive, not permission to subdivide or construct.
  const lotProfile = properties ? {
    ownership: String(properties.tipo_propi || 'No disponible'),
    status: String(properties.estado_lot || 'No disponible'),
    use: String(properties.uso_constr || 'No disponible'),
    landUse: String(properties.destino_ec || 'No disponible'),
    landArea: properties.area_terre,
    frontage: properties.frente,
    constructionArea: properties.area_const,
  } : null;

  // Determine whether this is Propiedad Horizontal
  const isPH =
    properties?.tipo_propi?.trim().toUpperCase() ===
    'PROPIEDAD HORIZONTAL';
  // Construction dates are not inferred from the parcel geometry or cadastral update year.
  // Only use a documented construction-year attribute once its schema is validated.
  const constructionYear = null;
  const existingConstruction = Number(properties?.area_const) > 0;
  const minimumLot = Number(irmValues.minLot);
  const relevantArea = Number(cadastralAreaValue);
  const smallerThanMinimum = irmExtraction && minimumLot > 0 && relevantArea > 0 && relevantArea < minimumLot;


  // Urban/rural classification from municipal 2024 cadastral attribute.
  // Do not infer a classification when the field is absent or ambiguous.
  const landClassification = (() => {
    const raw = String(properties?.zonificaci || '').trim().toUpperCase();
    if (raw === 'URBANO' || raw === 'URBANA') return 'Urbano';
    if (raw === 'RURAL') return 'Rural';
    return 'No determinado';
  })();

  // For PH, show the attributed land area.
  // For ordinary properties, show the full parcel area.
  const displayedLandArea = isPH
    ? properties?.area_ter_1
    : properties?.area_terre;

  // ==========================================================
  // 3. SEARCH MUNICIPAL PROPERTY
  // ==========================================================

  async function lookupPredio(type, value, openFicha = false) {
    individualController.current?.abort();
    const controller = new AbortController();
    individualController.current = controller;
    const requestId = ++individualRunId.current;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 75000);
    const slowTimer = setTimeout(() => setSlowLookup(true), 7000);
    setLoading(true); setSlowLookup(false); setError('');
    try {
      const response = await fetch(`${API}/api/predios/${type}/${encodeURIComponent(value)}`, {signal: controller.signal});
      const body = await response.json();
      if (requestId !== individualRunId.current) return;
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'No se pudo consultar el predio. Inténtalo de nuevo.');
      if (!body.features?.length) throw new Error('No se encontró un predio con ese identificador. Revisa el número e inténtalo de nuevo.');
      // The first parcel link adds context to a standalone drawing. Keep its
      // layout; the planner still requires explicit correspondence review.
      // Changing an already linked parcel is handled by the document reset effect.
      setData(body); setDetailsCollapsed(false); setStep('property');
      if (openFicha) {
        setIdentifierType('n_predio'); setIdentifier(value);
        setAudience('developer'); setPage('property');
        window.location.hash = routeForPage('property');
      }
    } catch (err) {
      if (requestId !== individualRunId.current || (controller.signal.aborted && !timedOut)) return;
      setError(timedOut ? 'La consulta está tardando más de lo previsto. Inténtalo de nuevo; el servicio puede estar iniciándose.' : err.message === 'Failed to fetch' ? 'No se pudo conectar al servicio de consulta. Comprueba tu conexión e inténtalo de nuevo.' : err.message);
    } finally {
      clearTimeout(timeout); clearTimeout(slowTimer);
      if (requestId === individualRunId.current) { setLoading(false); setSlowLookup(false); }
    }
  }

  async function search(event) {
    event.preventDefault();
    const value = identifier.trim();
    if (!/^\d{1,25}$/.test(value)) { setError('Ingresa un identificador numérico válido.'); return; }
    if (identifierType === 'clave_cata' && value.length > 10) { setError('La clave catastral no puede superar los 10 dígitos.'); return; }
    setStep('property');
    await lookupPredio(identifierType, value);
  }

  function clearIndividualPredioSearch() {
    individualController.current?.abort(); individualRunId.current++;
    setLoading(false); setSlowLookup(false);
    setIdentifier('');
    setData(null);
    setError('');
    setStep('property');
    setPugsData(null);
    setPugsError('');
    setDeveloperIrm(null);
    setIrmExtraction(null);
    setIrmConfirmed(false);
    setInspection(null);
    setPdf(null); setIrmPdf(null); setInspectionError('');
    lastDocumentPredio.current = null;
    setDocumentInputVersion(version => version + 1);
    setIrmCopyStatus('');
  }

  // Cadastral discovery: query real municipal attributes, never infer PUGS
  // classifications from cadastral land-use labels. Results are paginated.
  const CADASTRE_SEARCH='https://geoquito.quito.gob.ec/server/rest/services/Hosted/predios_a_2024/FeatureServer/0/query';
  const DMQ_PARISHES = {
    urban: [["BELISARIO QUEVEDO","Belisario Quevedo"],["CARCELEN","Carcelén"],["CENTRO HISTORICO","Centro Histórico"],["CHILIBULO","Chilibulo"],["CHILLOGALLO","Chillogallo"],["CHIMBACALLE","Chimbacalle"],["COCHAPAMBA","Cochapamba"],["COMITE DEL PUEBLO","Comité del Pueblo"],["COTOCOLLAO","Cotocollao"],["EL CONDADO","El Condado"],["GUAMANI","Guamaní"],["INAQUITO","Iñaquito"],["ITCHIMBIA","Itchimbía"],["JIPIJAPA","Jipijapa"],["KENNEDY","Kennedy"],["LA ARGELIA","La Argelia"],["LA CONCEPCION","La Concepción"],["LA ECUATORIANA","La Ecuatoriana"],["LA FERROVIARIA","La Ferroviaria"],["LA LIBERTAD","La Libertad"],["LA MAGDALENA","La Magdalena"],["LA MENA","La Mena"],["MARISCAL SUCRE","Mariscal Sucre"],["PONCEANO","Ponceano"],["PUENGASI","Puengasí"],["QUITUMBE","Quitumbe"],["RUMIPAMBA","Rumipamba"],["SAN BARTOLO","San Bartolo"],["SAN ISIDRO DEL INCA","San Isidro del Inca"],["SAN JUAN","San Juan"],["SOLANDA","Solanda"],["TURUBAMBA","Turubamba"]],
    rural: [["ALANGASI","Alangasí"],["AMAGUANA","Amaguaña"],["ATAHUALPA","Atahualpa"],["CALACALI","Calacalí"],["CALDERON","Calderón"],["CHAVEZPAMBA","Chavezpamba"],["CHECA","Checa"],["CONOCOTO","Conocoto"],["CUMBAYA","Cumbayá"],["EL QUINCHE","El Quinche"],["GUALEA","Gualea"],["GUANGOPOLO","Guangopolo"],["GUAYLLABAMBA","Guayllabamba"],["LA MERCED","La Merced"],["LLANO CHICO","Llano Chico"],["LLOA","Lloa"],["NANEGAL","Nanegal"],["NANEGALITO","Nanegalito"],["NAYON","Nayón"],["NONO","Nono"],["PACTO","Pacto"],["PERUCHO","Perucho"],["PIFO","Pifo"],["PINTAG","Píntag"],["POMASQUI","Pomasqui"],["PUELLARO","Puéllaro"],["PUEMBO","Puembo"],["SAN ANTONIO DE PICHINCHA","San Antonio de Pichincha"],["SAN JOSE DE MINAS","San José de Minas"],["TABABELA","Tababela"],["TUMBACO","Tumbaco"],["YARUQUI","Yaruquí"],["ZAMBIZA","Zámbiza"]]
  };
  const VALLEY_PARISHES=['CUMBAYA','TUMBACO','PUEMBO','PIFO','TABABELA','YARUQUI','CHECA','EL QUINCHE','GUAYLLABAMBA','NAYON','ZAMBIZA'];
  // Phase 1: direct cadastral GIS search. PUGS and IRM are reviewed per predio later.
  // Drag panel edges to adjust widths without changing the GIS result set.
  function startPanelResize(event, panel) {
    if(event.button!==0 || window.matchMedia('(max-width: 900px)').matches)return;
    event.preventDefault();
    const originX=event.clientX;
    const originWidth=panel==='details'?detailsWidth:resultsWidth;
    const update=move=>{
      const delta=move.clientX-originX;
      const width=Math.min(panel==='details'?680:680,Math.max(panel==='details'?270:270,
        originWidth+(panel==='details'?delta:-delta)));
      if(panel==='details')setDetailsWidth(width);
      else setResultsWidth(width);
    };
    const finish=()=>{
      window.removeEventListener('pointermove',update);
      window.removeEventListener('pointerup',finish);
      window.removeEventListener('pointercancel',finish);
      document.body.style.cursor='';
      document.body.style.userSelect='';
    };
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';
    window.addEventListener('pointermove',update);
    window.addEventListener('pointerup',finish);
    window.addEventListener('pointercancel',finish);
  }

  // VU/VB/VM evidence only. Numeric unidad_viv values are NOT mapped to
  // dwelling codes: official PUGS/IRM verification is still required.
  function getPugsHousingEvidence(result) {
    if(!result || !['single_zone','multiple_zones'].includes(result.status))
      return {code:'PENDIENTE',detail:'Clasificación no disponible'};
    const zones=result.zones||[];
    const found=new Set();
    for(const z of zones){
      for(const value of [z.cod_edi_es,z.unidad_viv,z.edifi_ba,z.edifi_gm]){
        const raw=String(value||'').toUpperCase();
        const matches=raw.match(/(^|[^A-Z])(VU|VB|VM)(?=$|[^A-Z])/g)||[];
        for(const token of matches){
          const code=token.match(/VU|VB|VM/);
          if(code)found.add(code[0]);
        }
      }
    }
    const codes=[...found];
    if(codes.length===1)return {code:codes[0],detail:zones.length>1?'Varias zonas PUGS: revisar intersección':'Código PUGS preliminar'};
    if(codes.length>1)return {code:'MIXTO',detail:'Códigos diferentes en zonas intersectadas'};
    return {code:'SIN_CODIGO',detail:'Sin VU/VB/VM explícito en campos examinados'};
  }

  async function screenAdvancedPugs() {
    const runId=++advancedRunId.current;
    const features=(exploreGeometries?.features||[]).filter(feature=>
      /^\d+$/.test(String(feature.properties?.n_predio||'')) && feature.geometry);
    if(!features.length){
      setAdvancedError('Esta página no contiene polígonos GIS utilizables para el cruce PUGS.');
      return;
    }
    if(API.includes('localhost') && !['localhost','127.0.0.1'].includes(window.location.hostname)){
      setAdvancedError('El análisis PUGS requiere un backend público configurado con VITE_API_URL. La búsqueda GIS continúa disponible.');
      return;
    }
    setAdvancedBusy(true);
    setAdvancedError('');
    setAdvancedRows({});
    setAdvancedFilter('all');
    setAdvancedProgress(`Consultando la zonificación de ${features.length} predios de esta página…`);
    try{
      // Respect the API's 100-feature cap even in the 200-card icon view.
      // Keep partial batches explicitly labeled if a later batch is unavailable.
      const rows = {};
      let screened = 0;
      let unavailable = 0;
      for (let offset = 0; offset < features.length; offset += 100) {
        if (runId !== advancedRunId.current) return;
        const batch = features.slice(offset, offset + 100);
        const response = await fetch(`${API}/api/pugs/spatial-screen`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({features: batch})
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'No se pudo completar la revisión de zonificación.');
        if (runId !== advancedRunId.current) return;
        for (const item of payload.results || []) rows[String(item.predio)] = {...item, ...getPugsHousingEvidence(item)};
        screened += payload.screened || 0;
        unavailable += (payload.results || []).filter(item => item.status === 'unavailable' || item.status === 'ambiguous').length;
        setAdvancedRows({...rows});
        setAdvancedProgress(`${screened} de ${features.length} predios revisados${unavailable ? ` · ${unavailable} sin resultado verificable` : ''}. ${offset + 100 < features.length ? 'Continuando con el siguiente grupo…' : 'Contrasta la evidencia con el IRM.'}`);
      }
    }catch(error){
      if(runId===advancedRunId.current){
        setAdvancedError(error.message||'El análisis espacial PUGS no está disponible.');
        setAdvancedProgress('La revisión no se completó. Los resultados disponibles son parciales; los demás predios quedan pendientes.');
      }
    }finally{
      if(runId===advancedRunId.current)setAdvancedBusy(false);
    }
  }

  const visibleExploreResults=advancedFilter==='all'
    ? exploreResults
    : exploreResults.filter(p=>advancedRows[String(p.n_predio)]?.code===advancedFilter);
  const visibleExploreIds=new Set(visibleExploreResults.map(p=>String(p.n_predio)));
  const visibleExploreGeometries=advancedFilter==='all'||!exploreGeometries
    ? exploreGeometries
    : {...exploreGeometries,features:exploreGeometries.features.filter(f=>visibleExploreIds.has(String(f.properties?.n_predio)))};

  function clearGISExploration() {
    exploreRunId.current++; setExploreBusy(false);
    advancedRunId.current++;
    setAdvancedBusy(false);
    setExploreSelected(null);
    setExploreResults([]);
    setExploreGeometries(null);
    setExploreAllGeometries(null);setExploreAllOrder([]);setExploreMapNotice('');
    setExploreCount(null);
    setExploreOffset(0);
    setExploreQueryKey('');
    setExploreSearchOpen(true);
    setExploreError('');
    setAdvancedRows({});setAdvancedProgress('');setAdvancedError('');setAdvancedFilter('all');
    // Keep chosen filters so the user can refine rather than re-enter them.
    requestAnimationFrame(()=>document.getElementById('predio-query-selector')?.scrollIntoView({behavior:scrollBehavior(),block:'start'}));
  }

  const selectedExploreParcel = exploreResults.find(p => String(p.n_predio) === exploreSelected)
    || exploreAllGeometries?.features?.find(f => String(f.properties?.n_predio) === exploreSelected)?.properties;

  const explorationFilterKey=[
    searchAreaMin,searchAreaMax,[...searchParishes].sort().join(','),
    searchLandClass,exploreSort,
    constructionRatioMax.trim()!==''?'ratio-max:'+constructionRatioMax:'ratio:off',
    minimumFrontage,administrativeZone,ownershipRegime
  ].join('|');

  useEffect(()=>{
    if(audience!=='explorer')return;
    let cancelled=false;
    const loadZones=async()=>{
      setAdministrativeZoneError('');
      try{
        const params=new URLSearchParams({
          f:'json',where:'administra IS NOT NULL',
          outFields:'administra',returnDistinctValues:'true',
          returnGeometry:'false',orderByFields:'administra ASC',resultRecordCount:'200'
        });
        const response=await fetch(CADASTRE_SEARCH+'?'+params);
        if(!response.ok)throw new Error('HTTP '+response.status);
        const data=await response.json();
        if(data.error)throw new Error(data.error.message||'ArcGIS error');
        if(data.exceededTransferLimit)throw new Error('Lista municipal incompleta');
        const zones=[...new Set((data.features||[]).map(f=>String(f.attributes?.administra||'').trim()).filter(Boolean))];
        if(!cancelled)setAdministrativeZoneOptions(zones.sort((a,b)=>a.localeCompare(b,'es')));
      }catch(error){
        if(!cancelled)setAdministrativeZoneError('No se pudo consultar la lista de administraciones zonales.');
      }
    };
    loadZones();
    return ()=>{cancelled=true;};
  },[audience]);

  useEffect(()=>{
    if(audience!=='explorer')return;
    let cancelled=false;
    const loadRegimes=async()=>{
      setOwnershipRegimeError('');
      try{
        const params=new URLSearchParams({
          f:'json',where:'tipo_propi IS NOT NULL',
          outFields:'tipo_propi',returnDistinctValues:'true',
          returnGeometry:'false',orderByFields:'tipo_propi ASC',resultRecordCount:'200'
        });
        const response=await fetch(CADASTRE_SEARCH+'?'+params);
        if(!response.ok)throw new Error('HTTP '+response.status);
        const payload=await response.json();
        if(payload.error)throw new Error(payload.error.message||'ArcGIS error');
        if(payload.exceededTransferLimit)throw new Error('Lista municipal incompleta');
        const regimes=[...new Set((payload.features||[]).map(f=>String(f.attributes?.tipo_propi||'').trim()).filter(Boolean))];
        if(!cancelled)setOwnershipRegimeOptions(regimes.sort((a,b)=>a.localeCompare(b,'es')));
      }catch(error){
        if(!cancelled)setOwnershipRegimeError('No se pudo consultar la lista de regímenes de propiedad.');
      }
    };
    loadRegimes();
    return ()=>{cancelled=true;};
  },[audience]);

  const explorePageSize=reelColumns===1?listPageSize:iconPageSize;
  async function exploreParcels(offset=0, sort=exploreSort, pageSize=explorePageSize, preserveSelection=false) {
    setExploreError('');
    const min=Number(searchAreaMin), max=Number(searchAreaMax);
    if(!searchAreaMin||!searchAreaMax||!Number.isFinite(min)||!Number.isFinite(max)||min<=0||max<min){
      setExploreError('Ingrese un rango de superficie válido.'); return;
    }
    const ratioActive=constructionRatioMax.trim()!=='';
    const ratioMax=Number(constructionRatioMax);
    if(ratioActive&&(!Number.isFinite(ratioMax)||ratioMax<0||ratioMax>100)){
      setExploreError('Ingrese un porcentaje máximo entre 0 y 100.');return;
    }
    const frontage=minimumFrontage.trim()===''?null:Number(minimumFrontage);
    if(frontage!==null&&(!Number.isFinite(frontage)||frontage<0)){
      setExploreError('Ingrese un frente mínimo válido (m).');return;
    }
    const runId = ++exploreRunId.current;
    advancedRunId.current++;
    setAdvancedBusy(false);
    setExploreError('');
    setAdvancedRows({});setAdvancedProgress('');setAdvancedError('');setAdvancedFilter('all');
    if(!preserveSelection && offset===0){setExploreAllGeometries(null);setExploreAllOrder([]);setExploreMapNotice('');}
    if(!preserveSelection)setExploreSelected(null);
    const clauses=['area_terre >= '+min,'area_terre <= '+max];
    // Optional maximum registered construction/land ratio, applied before
    // counting and pagination. Blank input disables this filter.
    if(ratioActive){
      clauses.push('area_const IS NOT NULL','area_terre > 0',
        '(area_const * 100) <= (area_terre * '+ratioMax+')');
    }
    if(frontage!==null)clauses.push('frente >= '+frontage);
    if(administrativeZone!=='all')
      clauses.push("administra = '"+administrativeZone.replace(/'/g,"''")+"'");
    if(ownershipRegime!=='all')
      clauses.push("tipo_propi = '"+ownershipRegime.replace(/'/g,"''")+"'");
    if(searchParishes.length) {
      clauses.push('('+searchParishes.map(p=>"UPPER(parroquia) = '"+p.replace(/'/g,"''")+"'").join(' OR ')+')');
    }
    if(searchLandClass==='urban')clauses.push("UPPER(zonificaci) IN ('URBANO','URBANA')");
    if(searchLandClass==='rural')clauses.push("UPPER(zonificaci) = 'RURAL'");
    const where=clauses.join(' AND ');
    setExploreBusy(true);
    try {
      const query=async extra=>{
        const params=new URLSearchParams({f:'json',where,...extra});
        const response=await fetch(CADASTRE_SEARCH+'?'+params);
        if(!response.ok)throw new Error('HTTP '+response.status);
        const payload=await response.json();
        if(payload.error)throw new Error(payload.error.message||'Error municipal');
        return payload;
      };
      const ordering=sort==='largest'?'area_terre DESC, n_predio ASC':sort==='smallest'?'area_terre ASC, n_predio ASC':'n_predio ASC';
      const outFields='n_predio,clave_cata,parroquia,area_terre,area_ter_1,area_const,frente,administra,tipo_propi,zonificaci';
      const [counts,results]=await Promise.all([
        query({returnCountOnly:'true',returnGeometry:'false'}),
        query({outFields,returnGeometry:'true',outSR:'4326',orderByFields:ordering,resultOffset:String(offset),resultRecordCount:String(pageSize)})
      ]);
      if (runId !== exploreRunId.current) return;
      const count=Number(counts.count||0);
      setExploreCount(count);
      setExploreResults((results.features||[]).map(feature=>feature.attributes||{}));
      if((results.features||[]).length)requestAnimationFrame(()=>document.getElementById('predio-map-reel')?.scrollIntoView({behavior:scrollBehavior(),block:'nearest'}));
      // Convert ArcGIS rings to GeoJSON. Ring orientation is not guaranteed
      // for all municipal records; never discard a feature solely because its
      // outer ring is counterclockwise. Assign holes by containment.
      const pointInRing=(point,ring)=>{
        let inside=false;
        for(let i=0,j=ring.length-1;i<ring.length;j=i++){
          const [xi,yi]=ring[i],[xj,yj]=ring[j];
          if((yi>point[1])!==(yj>point[1]) && point[0]<(xj-xi)*(point[1]-yi)/(yj-yi)+xi)inside=!inside;
        }
        return inside;
      };
      const convertArcGISFeature=f=>{
        const rings=(f.geometry?.rings||[]).filter(r=>Array.isArray(r)&&r.length>=4);
        if(!rings.length)return [];
        const signed=ring=>ring.reduce((acc,p,i)=>{
          const q=ring[(i+1)%ring.length];return acc+p[0]*q[1]-q[0]*p[1];
        },0);
        const records=rings.map(ring=>({ring,area:Math.abs(signed(ring))})).sort((a,b)=>b.area-a.area);
        const polygons=[];
        for(const item of records){
          // The largest containing shell holds each interior ring; other rings
          // are independent shells (including counterclockwise outer rings).
          const container=polygons.find(poly=>pointInRing(item.ring[0],poly[0]));
          if(container)container.push(item.ring);
          else polygons.push([item.ring]);
        }
        return [{type:'Feature',properties:f.attributes||{},
          geometry:{type:'MultiPolygon',coordinates:polygons}}];
      };
      const geometries=(results.features||[]).flatMap(convertArcGISFeature);
      setExploreGeometries({type:'FeatureCollection',features:geometries});
      // Keep the full query overlay independent from the current card page.
      // Limit initial loading to a safe bounded scope; never claim that
      // partial map coverage represents every matched municipal record.
      if(!preserveSelection && offset===0){
        const maxMapped=1000;
        if(count>maxMapped){
          setExploreMapNotice(`Mapa: primeros ${maxMapped.toLocaleString('es-EC')} de ${count.toLocaleString('es-EC')} predios; refine los filtros para visualizar todos.`);
        }
        const mapFeatures=[...(results.features||[])];
        const totalToMap=Math.min(count,maxMapped);
        for(let next=pageSize;next<totalToMap;next+=200){
          const batch=await query({outFields,returnGeometry:'true',outSR:'4326',orderByFields:ordering,
            resultOffset:String(next),resultRecordCount:String(Math.min(200,totalToMap-next))});
          if (runId !== exploreRunId.current) return;
          mapFeatures.push(...(batch.features||[]));
          if(!(batch.features||[]).length)break;
        }
        const allGeo=mapFeatures.flatMap(f=>convertArcGISFeature(f));
        setExploreAllGeometries({type:'FeatureCollection',features:allGeo});
        setExploreAllOrder(mapFeatures.map(f=>String(f.attributes?.n_predio||'')));
        if(allGeo.length<totalToMap)setExploreMapNotice(`Mapa parcial: ${allGeo.length} de ${count} predios con geometría recuperada.`);
      }
      if (runId !== exploreRunId.current) return;
      setExploreOffset(offset);
      setExploreQueryKey([searchAreaMin,searchAreaMax,[...searchParishes].sort().join(','),searchLandClass,sort,constructionRatioMax.trim()!==''?'ratio-max:'+constructionRatioMax:'ratio:off',minimumFrontage,administrativeZone,ownershipRegime].join('|'));
      if(offset===0 && count > 0)setExploreSearchOpen(false);
    }catch(error){
      if (runId !== exploreRunId.current) return;
      setExploreError('No se pudo completar la búsqueda municipal. Revisa la conexión e inténtalo de nuevo.');
      setExploreResults([]);setExploreGeometries(null);setExploreCount(null);
      setExploreAllGeometries(null);setExploreAllOrder([]);setExploreMapNotice('');setExploreSelected(null);
    }finally{if (runId === exploreRunId.current) setExploreBusy(false);}
  }
  async function openExplorePredio(predio) {
    if (!/^\d+$/.test(String(predio))) return;
    await lookupPredio('n_predio', String(predio), true);
  }

  // ==========================================================
  // 4. INSPECT ARCHITECTURAL DOCUMENT
  // ==========================================================

  // OPTIONAL DOCUMENT ANALYSIS V2 — BEGIN
  // One request carries selected predio, building/work type, blueprint and IRM.
  // To revert, restore the original two-document inspection handler.
  async function inspect(packageEntry = activePackage?.selected_entry || null) {
    if (!pdf || !activities.length) return;
    if (packageEntry && !activePackage?.entries.some(entry => entry.path === packageEntry)) return;
    setDrawingExample(null);
    irmAttachController.current?.abort(); irmAttachRunId.current++; setAttachingIrm(false);
    inspectionController.current?.abort();
    const controller = new AbortController();
    inspectionController.current = controller;
    const runId = ++inspectionRunId.current;
    let timedOut = false;
    const requestTimeout = inspectionTimeoutMs(pdf);
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeout);
    setInspecting(true);
    setPendingPackageEntry(packageEntry);
    setInspection(null);
    setInspectionError('');
    try {
      const form = createInspectionForm({
        blueprint: pdf, irm: irmPdf, buildingType, workType, activities,
        predioNumber: properties?.n_predio || properties?.predio, packageEntry,
      });
      const response = await fetch(`${API}/api/documents/analyze`, {
        method: 'POST', body: form, signal: controller.signal
      });
      const body = await response.json().catch(() => null);
      if (runId !== inspectionRunId.current) return;
      if (!response.ok || !body?.blueprint) {
        const detail = body?.detail;
        throw new Error(typeof detail === 'string'
          ? detail : 'No se pudo inspeccionar el archivo. Revisa el formato e inténtalo de nuevo.');
      }
      setPackageRecord(body.blueprint.package ? { file: pdf, manifest: body.blueprint.package } : null);
      setInspection(body);
      setInspectedIrmFile(irmPdf);
      setProjectSetupOpen(false);
      requestAnimationFrame(() => document.getElementById('drawing-workspace')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }));
    } catch (err) {
      if (runId !== inspectionRunId.current || (controller.signal.aborted && !timedOut)) return;
      setInspectionError(timedOut
        ? 'El análisis está tardando más de lo previsto. El servicio puede estar iniciándose. Inténtalo de nuevo.'
        : err.message === 'Failed to fetch'
          ? 'No se pudo conectar al servicio de análisis. Comprueba tu conexión e inténtalo de nuevo.'
          : err.message);
    } finally {
      clearTimeout(timeout);
      if (runId === inspectionRunId.current) {
        setInspecting(false);
        setPendingPackageEntry(null);
      }
    }
  }
  // OPTIONAL DOCUMENT ANALYSIS V2 — END

  // ==========================================================
  // 5. USER INTERFACE
  // ==========================================================

  return (
    <div className={`shell${page === 'blueprints' ? ' planning-studio' : ''}`}>

      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Ir al contenido</a>
      <header className="header">
        <button type="button" className="brand app-header-brand" aria-label="PredioAI · Inicio" onClick={() => navigate('home')}>
          <span className="brand-mark" aria-hidden="true"><svg width="24" height="26" viewBox="0 0 24 26" fill="none"><path d="M3 7 12 2l9 5v12l-9 5-9-5V7Z" stroke="currentColor" strokeWidth="1.5"/><path d="m3 7 9 5 9-5M12 12v12M7.5 4.5l9 5v12" stroke="currentColor" strokeWidth="1.5"/></svg></span>
          <span><strong>Predio<span>AI</span></strong><small>PLANOS Y PROPIEDAD</small></span>
        </button>
        <nav className="primary-nav" aria-label="Navegación principal">
          {[['home','Inicio'],['blueprints','Analizar planos'],['property','Mi predio'],['explore','Explorar mapa'],['selection','Selección']].map(([key,label]) => <button key={key} type="button" className={page === key ? 'active' : ''} aria-current={page === key ? 'page' : undefined} onClick={() => navigate(key)}>{label}{key === 'selection' && <span className="nav-count">{savedParcels.length}</span>}{key === 'analytics' && <span className="nav-soon">Próxima etapa</span>}</button>)}
        </nav>
        <div className="header-context"><span>Quito, Ecuador</span><span className="version">Versión piloto</span></div>
      </header>

      <main id="main-content" className="workspace-main" tabIndex={-1}>
      {page === 'home' && <ProductOverview onExplore={() => navigate('explore')} onConsult={() => navigate('property')} onBlueprints={() => navigate('blueprints')} onAnalytics={() => navigate('analytics')} />}
      {page === 'selection' && <SelectionPage records={savedParcels} onExplore={() => navigate('explore')} onOpen={openExplorePredio} onRemove={id => { setSavedParcels(current => current.filter(p => p.n_predio !== id)); setSelectionNotice(`Predio ${id} retirado de la selección.`); }} onImport={importParcels} onIrmReview={setIrmReviewStatus} onEnrich={enrichImportedPredios} loading={loading} error={error} storageAvailable={storageAvailable} />}
      {page === 'analytics' && <AnalyticsRoadmap onExplore={() => navigate('explore')} onSelection={() => navigate('selection')} />}
      {isWorkspace && <>
      {loading && <div className="lookup-progress" role="status">{slowLookup ? 'El servicio está iniciándose o consultando fuentes municipales. La ficha aparecerá al terminar.' : 'Consultando la ficha del predio…'}</div>}
      <div className="workspace-context-bar">
        <div className="workspace-breadcrumb"><span>Espacio de trabajo</span><span aria-hidden="true">/</span><strong>{audience === 'explorer' ? 'Explorar predios' : properties ? `Predio ${properties.n_predio}` : audience === 'remodeler' ? 'Planos de mi vivienda' : 'Ficha predial'}</strong></div>
        <span className="workspace-stage">{audience === 'explorer' ? 'Consulta territorial' : audience === 'remodeler' ? 'Inspección experimental' : 'Información municipal'}</span>
      </div>
      {page === 'property' && <div className="workspace-mode-switch" role="group" aria-label="Tipo de revisión">
        <span>Revisar para</span>
        <button type="button" aria-pressed={audience === 'developer'} className={audience === 'developer' ? 'active' : ''} onClick={() => { setAudience('developer'); setStep('property'); }}>Información urbanística</button>
        <button type="button" onClick={() => navigate('blueprints')}>Planos de mi vivienda →</button>
      </div>}
      {page === 'blueprints' && <section className="blueprint-intro" aria-label="Análisis de planos"><div><p className="eyebrow">ESTUDIO DE TU VIVIENDA</p><h1>Tu plano. Tus ideas, a escala.</h1><p>Explora el dibujo, prueba la distribución de tus muebles y prepara una propuesta de ampliación. Añade el predio y su IRM cuando tengas los documentos correspondientes.</p></div><div className="studio-capabilities" aria-label="Herramientas del estudio"><span>01 <strong>Medir</strong></span><span>02 <strong>Proponer</strong></span><span>03 <strong>Implantar</strong></span><small>PDF · DXF · DWG · ZIP</small></div></section>}
      {audience !== 'explorer' && <nav className="workflow-nav" aria-label="Etapas del proyecto">
        {audience === 'developer' ? <>
          <button type="button" className={step === 'property' ? 'active' : ''} onClick={() => setStep('property')}>1 · Predio</button>
          <button type="button" className={step === 'project' ? 'active' : ''} disabled={!properties} onClick={() => setStep('project')}>2 · IRM y evaluación</button>
        </> : <>
          <button type="button" className={step === 'project' ? 'active' : ''} onClick={() => setStep('project')}>1 · Planos y actividades</button>
          <button type="button" className={step === 'report' ? 'active' : ''} disabled={!inspection} onClick={() => setStep('report')}>2 · Resumen documental</button>
          <button type="button" className={step === 'property' ? 'active' : ''} onClick={() => setStep('property')}>{properties ? 'Ver predio vinculado' : 'Vincular predio (opcional)'}</button>
        </>}
      </nav>}
      {page === 'blueprints' && step === 'property' && <div className="plan-property-return"><p>Esta consulta agrega contexto municipal. Puedes inspeccionar tus planos aunque todavía no conozcas el número de predio.</p><button type="button" className="secondary" onClick={() => setStep('project')}>Continuar con mis planos →</button></div>}
      {audience === 'explorer' && <section id="predio-query-selector" className="development-search-criteria" aria-label="Criterios de exploración de terrenos">
        <div className="gis-search-heading">
          <div><span className="eyebrow">BÚSQUEDA TERRITORIAL</span><h1>Encuentra el predio que estás buscando.</h1></div>
          <button type="button" className="secondary gis-edit-search" aria-expanded={exploreSearchOpen}
            onClick={()=>setExploreSearchOpen(open=>!open)}>{exploreSearchOpen?'Ocultar criterios':'Editar búsqueda'}</button>
        </div>
        {!exploreSearchOpen&&<div className="gis-search-summary" role="status">
          <strong>{searchLandClass==='urban'?'Urbano':searchLandClass==='rural'?'Rural':'Urbano y rural'}</strong>
          <span>{searchAreaMin}–{searchAreaMax} m²</span>
          <span>{searchParishes.length?searchParishes.length===1?([...DMQ_PARISHES.urban,...DMQ_PARISHES.rural].find(([code])=>code===searchParishes[0])?.[1]||searchParishes[0]):searchParishes.length+' parroquias':'Todas las parroquias'}</span>
          <span>{[
            constructionRatioMax.trim()!=='' ,minimumFrontage.trim()!=='',
            administrativeZone!=='all',ownershipRegime!=='all'
          ].filter(Boolean).length} filtros adicionales</span>
          {exploreCount!==null&&exploreQueryKey===explorationFilterKey&&
            <span>{exploreCount.toLocaleString('es-EC')} predios coincidentes</span>}
          {exploreQueryKey&&exploreQueryKey!==explorationFilterKey&&<span>Criterios modificados · buscar de nuevo</span>}
        </div>}
        {exploreSearchOpen&&<form className="gis-search-form" onSubmit={event => { event.preventDefault(); exploreParcels(0); }}>
        <p className="note gis-search-intro">Define la superficie y la ubicación. Después, abre una ficha o guarda los predios que quieras comparar.</p>
        <div className="search-preset-row" role="group" aria-label="Ubicaciones rápidas"><span>Empieza por una zona</span>{[['CUMBAYA','Cumbayá'],['TUMBACO','Tumbaco'],['PUEMBO','Puembo']].map(([value,label]) => <button type="button" key={value} className={searchParishes.length===1&&searchParishes[0]===value?'active':''} aria-pressed={searchParishes.length===1&&searchParishes[0]===value} onClick={() => {setSearchLandClass('all');setSearchParishes([value]);}}>{label}</button>)}<button type="button" onClick={() => {setSearchParishes([]);setSearchLandClass('all');}}>Todo Quito</button></div>
        <div className="development-filter-grid gis-primary-fields">
          <label>Clasificación del suelo
            <select value={searchLandClass} onChange={e=>setSearchLandClass(e.target.value)}>
              <option value="all">Urbano y rural</option>
              <option value="urban">Suelo urbano</option>
              <option value="rural">Suelo rural</option>
            </select>
          </label>
          <label>Superficie mínima (m²)
            <input type="number" min="1" step="1" value={searchAreaMin} onChange={e=>setSearchAreaMin(e.target.value)} />
          </label>
          <label>Superficie máxima (m²)
            <input type="number" min="1" step="1" value={searchAreaMax} onChange={e=>setSearchAreaMax(e.target.value)} />
          </label>
          <fieldset className="parish-selector">
            <legend>Parroquias / sectores ({searchParishes.length || 'todas'})</legend>
            <details><summary>{searchParishes.length === 1 ? [...DMQ_PARISHES.urban,...DMQ_PARISHES.rural].find(([code]) => code === searchParishes[0])?.[1] || searchParishes[0] : searchParishes.length ? `${searchParishes.length} parroquias seleccionadas` : 'Todas las parroquias'}</summary>
              <div className="parish-selector-actions">
                <button type="button" onClick={()=>setSearchParishes([])} className="parish-action">Deseleccionar todas</button>
                <button type="button" onClick={()=>setSearchParishes(old=>[...new Set([...old,...VALLEY_PARISHES])])} className="parish-action">Agregar valles</button>
                <button type="button" onClick={()=>setSearchParishes([...DMQ_PARISHES.urban,...DMQ_PARISHES.rural].map(x=>x[0]))} className="parish-action">
                  Seleccionar las 65
                </button>
              </div>
              <p className="note">La parroquia y la clasificación del suelo son filtros independientes. Una parroquia rural puede contener suelo urbano; la zonificación se verifica por predio.</p>
              <div className="parish-selector-list">
                {['urban','rural'].map(type=><div key={type} className="parish-selector-group"><strong>{type==='urban'?'Urbanas (32)':'Rurales (33)'}</strong>
                  {DMQ_PARISHES[type].map(([value,label])=><button key={value} type="button"
                    className={'parish-selector-option'+(searchParishes.includes(value)?' selected':'')}
                    aria-pressed={searchParishes.includes(value)}
                    onClick={()=>setSearchParishes(old=>old.includes(value)?old.filter(x=>x!==value):[...old,value])}>{label}
                  </button>)}
                </div>)}
              </div>
            </details>
          </fieldset>
          <details className="gis-optional-filters" open={exploreOptionalOpen}
            onToggle={e=>setExploreOptionalOpen(e.currentTarget.open)}>
            <summary>Filtros adicionales <span>{[
              constructionRatioMax.trim()!=='',minimumFrontage.trim()!=='',
              administrativeZone!=='all',ownershipRegime!=='all'
            ].filter(Boolean).length} activos</span></summary>
            <div className="gis-optional-grid">
              <label className="gis-ratio-field">Relación construcción / terreno (%) · máximo
                <input type="number" min="0" max="100" step="1" placeholder="Sin límite (0–100)"
                  value={constructionRatioMax} onChange={e=>setConstructionRatioMax(e.target.value)}/>
                <span className="note">Opcional. Muestre predios con relación construida igual o inferior al porcentaje indicado. Vacío = sin filtro; no equivale a COS.</span>
              </label>
              <label>Frente mínimo del terreno (m)
                <input type="number" min="0" step="0.1" placeholder="Sin mínimo"
                  value={minimumFrontage} onChange={e=>setMinimumFrontage(e.target.value)}/>
              </label>
              <label>Administración zonal
                <select value={administrativeZone} onChange={e=>setAdministrativeZone(e.target.value)}>
                  <option value="all">Todas las administraciones</option>
                  {administrativeZoneOptions.map(zone=><option key={zone} value={zone}>{zone}</option>)}
                  {administrativeZone!=='all'&&!administrativeZoneOptions.includes(administrativeZone)&&
                    <option value={administrativeZone}>{administrativeZone}</option>}
                </select>
                {administrativeZoneError&&<span role="status" className="gis-zone-error">{administrativeZoneError}</span>}
              </label>
              <label>Régimen de propiedad
                <select value={ownershipRegime} onChange={e=>setOwnershipRegime(e.target.value)}>
                  <option value="all">Todos los regímenes</option>
                  {ownershipRegimeOptions.map(regime=><option key={regime} value={regime}>{regime}</option>)}
                  {ownershipRegime!=='all'&&!ownershipRegimeOptions.includes(ownershipRegime)&&
                    <option value={ownershipRegime}>{ownershipRegime}</option>}
                </select>
                {ownershipRegimeError&&<span role="status" className="gis-zone-error">{ownershipRegimeError}</span>}
              </label>
            </div>
          </details>
        </div>
        <div className="search-form-actions"><button type="submit" className="primary-action" disabled={exploreBusy}>{exploreBusy?'Consultando catastro…':'Buscar predios →'}</button><button type="button" className="reset-search" disabled={exploreBusy} onClick={() => {setSearchAreaMin('500');setSearchAreaMax('6000');setSearchParishes([]);setSearchLandClass('all');setConstructionRatioMax('');setMinimumFrontage('');setAdministrativeZone('all');setOwnershipRegime('all');}}>Restablecer filtros</button></div>
        {exploreError&&<p role="alert" className="error">{exploreError}</p>}
         {exploreCount!==null&&exploreQueryKey===explorationFilterKey&&<div className="explore-results" aria-live="polite">
          <strong>{exploreCount.toLocaleString('es-EC')} registros catastrales coincidentes (2024)</strong>
          <p className="note">Se muestran hasta {explorePageSize} resultados por página, configurables desde la vista de resultados. La consulta utiliza superficie, parroquia y los filtros catastrales opcionales activos; al abrir un predio se consulta su geometría 2026 cuando está disponible. Los resultados no indican terrenos en venta ni autorización de construcción.</p>

        </div>}
        {Number(searchAreaMin)<=0||Number(searchAreaMax)<=0||searchAreaMin===''||searchAreaMax===''||Number(searchAreaMin)>Number(searchAreaMax)
          ? <p className="error" role="alert">Indique un rango de superficies válido, con mínimo menor o igual al máximo.</p>
          : null}
        </form>}
        {exploreQueryKey && exploreQueryKey !== explorationFilterKey && <p className="source-note" role="status">Modificaste los criterios. Pulsa «Buscar predios» para actualizar los resultados y el mapa.</p>}
        {exploreCount!==null&&<details className="advanced-landcover" open={advancedOpen} onToggle={event=>setAdvancedOpen(event.currentTarget.open)}>
          <summary>Revisar zonificación <span className="advanced-status">PUGS · Opcional</span></summary>
          <div className="advanced-landcover-content">
            <p>Primero se muestran los predios del catastro GIS. Después puede comparar los <strong>{exploreResults.length} predios de la página actual</strong> con la zonificación municipal PUGS 2024 y revisar la evidencia disponible de uso residencial.</p>
            <button type="button" className="primary-action" disabled={advancedBusy||!exploreResults.length}
              onClick={screenAdvancedPugs}>{advancedBusy?'Analizando PUGS…':'Revisar zonificación de esta página'}</button>
            {advancedProgress&&<p role="status">{advancedProgress}</p>}
            {advancedError&&<p role="alert" className="error">{advancedError}</p>}
            {Object.keys(advancedRows).length>0&&<>
              <label className="advanced-pugs-filter">Filtrar evidencia preliminar de vivienda
                <select value={advancedFilter} onChange={event=>{setAdvancedFilter(event.target.value);setExploreSelected(null);}}>
                  <option value="all">Todos los predios analizados y pendientes</option>
                  <option value="VU">VU — Vivienda unifamiliar</option>
                  <option value="VB">VB — Vivienda bifamiliar</option>
                  <option value="VM">VM — Vivienda multifamiliar</option>
                  <option value="MIXTO">Varios códigos en zonas PUGS</option>
                  <option value="SIN_CODIGO">Sin código explícito</option>
                  <option value="PENDIENTE">Sin clasificación verificable</option>
                </select>
              </label>
              <p>{visibleExploreResults.length} de {exploreResults.length} predios visibles en esta página según el filtro PUGS.</p>
            </>}
            <p className="note">La clasificación VU/VB/VM se extrae solo cuando el código aparece explícitamente en los campos cartográficos examinados. Una ausencia de código no significa prohibición. Las intersecciones y los códigos son provisionales y deben contrastarse con el IRM. No representa un conteo de todo Quito ni una aprobación constructiva.</p>
          </div>
        </details>}
      </section>}
      {/* MAIN LAYOUT */}


      {step === 'property' && (      <section className={'layout dashboard-layout'+(detailsCollapsed?' details-collapsed':'')+(audience==='explorer'?' explorer-layout':'')}
        style={{'--details-width':(detailsCollapsed?54:detailsWidth)+'px','--results-width':(resultsCollapsed?54:resultsWidth)+'px'}}>

        {audience !== 'explorer' && <aside className="sidebar details-sidebar">
          <div className="sidebar-panel-tools">
            <button type="button" className="panel-collapse-button" aria-expanded={!detailsCollapsed}
              aria-label={detailsCollapsed?'Expandir información del predio':'Contraer información del predio'}
              onClick={()=>setDetailsCollapsed(value=>!value)}>{detailsCollapsed?'›':'‹'}</button>
            {!detailsCollapsed&&<span>Información del predio</span>}
          </div>
          <div className="sidebar-panel-content">

          <div className="eyebrow">
            QUITO · ECUADOR
          </div>

          <h1>Una ficha.<br /><em>Más contexto.</em></h1>

          <p className="intro">
            Consulta los datos catastrales y reúne la evidencia para evaluar un inmueble.
          </p>

          {/* PROPERTY SEARCH */}

          <form
            onSubmit={search}
            className="search-form"
          >

            <label htmlFor="identifierType">
              BUSCAR PREDIO POR
            </label>

            <select
              id="identifierType"
              value={identifierType}
              onChange={(event) => {
                clearIndividualPredioSearch();
                setIdentifierType(event.target.value);
              }}
            >
              <option value="clave_cata">
                Clave catastral
              </option>

              <option value="n_predio">
                Número de predio
              </option>
            </select>

            <div className="search-row">

              <input
                id="predio"
                aria-label={identifierType === 'clave_cata' ? 'Clave catastral' : 'Número de predio'}
                autoComplete="off"
                maxLength={identifierType === 'clave_cata' ? 10 : 25}
                value={identifier}
                onChange={(event) =>
                  setIdentifier(event.target.value)
                }
                placeholder={
                  identifierType === 'clave_cata'
                    ? 'Ej.: 1041102014'
                    : 'Ej.: 627739'
                }
                inputMode="numeric"
              />

              <button
                type="submit"
                disabled={loading}
              >
                {loading
                  ? 'Buscando…'
                  : 'Buscar predio'}
              </button>

            </div>
          </form>

          {properties && <div className="individual-search-actions">
            <button type="button" className="primary-action" onClick={() => setStep('project')}>{audience === 'developer' ? 'Consultar IRM y evaluar →' : 'Iniciar proyecto →'}</button>
            <button type="button" className="secondary" disabled={savedParcels.some(p => p.n_predio === String(properties.n_predio))} onClick={() => saveParcel(properties)}>{savedParcels.some(p => p.n_predio === String(properties.n_predio)) ? 'Guardado en selección ✓' : 'Guardar en selección +'}</button>
            <button type="button" className="secondary" onClick={clearIndividualPredioSearch}>Limpiar búsqueda</button>
          </div>}

          {/* ERROR MESSAGE */}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {/* INFORMACIÓN CATASTRAL */}

          <div className="section-heading">
            INFORMACIÓN CATASTRAL
            <span>
              {properties
                ? 'ENCONTRADO'
                : 'SIN CONSULTA'}
            </span>
          </div>

          {properties ? (

            <div className="property">

              <div className="property-title">
                <strong>
                  Predio {properties.n_predio}
                </strong>

                <span>
                  {properties.parroquia || 'Quito'}
                </span>
              </div>

              {/* PROPERTY CLASSIFICATION */}

              {isPH && (
                <p className="note">
                  Régimen de propiedad horizontal (PH).
                  Esta unidad comparte el lote matriz con otras propiedades.
                </p>
              )}

              {/* PRIMARY MEASUREMENTS */}

              <div className="stats">

                <div>
                  <small>
                    {isPH
                      ? 'ÁREA DE TERRENO ATRIBUIDA'
                      : 'ÁREA DEL TERRENO'}
                  </small>

                  <strong>
                    {formatArea(displayedLandArea)}
                  </strong>
                </div>

                <div>
                  <small>
                    ÁREA TOTAL DE CONSTRUCCIÓN
                  </small>

                  <strong>
                    {formatArea(
                      properties.area_const
                    )}
                  </strong>
                </div>

              </div>

              {/* GENERAL PROPERTY ATTRIBUTES */}

              <dl>

                <dt>Número de predio</dt>
                <dd>
                  {properties.n_predio || '—'}
                </dd>

                <dt>Tipo de propiedad</dt>
                <dd>
                  {properties.tipo_propi || '—'}
                </dd>

                {/* OPTIONAL URBAN/RURAL CLASSIFICATION — BEGIN
                    Comment out these two elements to hide the indicator.
                    Based on the municipal 2024 'zonificaci' field.
                */}
                <dt>Clasificación del suelo</dt>
                <dd>
                  <strong>{landClassification}</strong>
                </dd>
                {/* OPTIONAL URBAN/RURAL CLASSIFICATION — END */}

                <dt>Zonificación (dato municipal)</dt>
                <dd>
                  {properties.zonificaci || '—'}
                </dd>

                <dt>Uso de la construcción</dt>
                <dd>
                  {properties.uso_constr || '—'}
                </dd>

              </dl>

              {/* PROPIEDAD HORIZONTAL DETAILS */}

              {isPH && (

                <div className="ph-details">

                  <div className="section-heading">
                    PROPIEDAD HORIZONTAL
                    <span>PH</span>
                  </div>

                  <dl>

                    <dt>Área del lote matriz</dt>
                    <dd>
                      {formatArea(
                        properties.area_terre
                      )}
                    </dd>

                    <dt>Área de terreno atribuida</dt>
                    <dd>
                      {formatArea(
                        properties.area_ter_1
                      )}
                    </dd>

                    <dt>Alícuota</dt>
                    <dd>
                      {typeof properties.alicuota_p ===
                      'number'
                        ? `${properties.alicuota_p.toFixed(2)}%`
                        : 'No disponible'}
                    </dd>

                    <dt>Construcción total</dt>
                    <dd>
                      {formatArea(
                        properties.area_const
                      )}
                    </dd>

                  </dl>

                  <p className="note">
                    El polígono resaltado corresponde al lote matriz,
                    no a la huella de la vivienda individual.
                    El área atribuida es una asignación catastral,
                    no una medición de terreno de uso exclusivo.
                  </p>

                </div>
              )}

              {/* OPTIONAL CADASTRAL VALUATION — BEGIN
                  Comment out this entire section to hide the 2024
                  land/construction/total breakdown. No API changes needed.
              */}
              <div className="ph-details">
                <div className="section-heading">
                  AVALÚO CATASTRAL <span>2024</span>
                </div>
                <p className="note">Pulsa cada concepto para ver su explicación. Los conceptos comunales son valores asignados a la unidad por su alícuota, no áreas privadas adicionales.</p>
                <dl>
                  <dt><ValuationTerm label="Avalúo del terreno" helpKey="avaluo_ter" /></dt>
                  <dd>{formatUSD(properties.avaluo_ter)}</dd>
                  <dt><ValuationTerm label="Avalúo de construcciones cubiertas" helpKey="avaluo_con" /></dt>
                  <dd>{formatUSD(properties.avaluo_con)}</dd>
                  {[
                    ['avaluo_c_1', 'Avalúo de construcciones abiertas'],
                    ['avaluo_c_2', 'Avalúo de instalaciones especiales'],
                    ['avaluo_c_3', 'Avalúo de construcciones comunales cubiertas proporcional a la alícuota'],
                    ['avaluo_c_4', 'Avalúo de construcciones comunales abiertas proporcional a la alícuota'],
                    ['avaluo_c_5', 'Avalúo de adicionales constructivos proporcional a la alícuota'],
                    ['avaluo_c_6', 'Avalúo comunal especial']
                  ].map(([key,label]) => <React.Fragment key={key}>
                    <dt><ValuationTerm label={label} helpKey={key} /></dt><dd>{formatUSD(properties[key])}</dd>
                  </React.Fragment>)}
                  <dt><ValuationTerm label="Avalúo total" helpKey="avaluo_tot" /></dt>
                  <dd><strong>{formatUSD(properties.avaluo_tot)}</strong></dd>
                  <dt><ValuationTerm label="Avalúo terreno por m² atribuido" helpKey="land_rate" /></dt>
                  <dd>{typeof properties.avaluo_ter === 'number' &&
                    typeof displayedLandArea === 'number' && displayedLandArea > 0
                    ? formatRate(properties.avaluo_ter / displayedLandArea)
                    : 'No disponible'}</dd>
                  <dt><ValuationTerm label="Avalúo construcción por m²" helpKey="construction_rate" /></dt>
                  <dd>{typeof properties.avaluo_con === 'number' &&
                    typeof properties.area_const === 'number' && properties.area_const > 0
                    ? formatRate(properties.avaluo_con / properties.area_const)
                    : 'No disponible'}</dd>
                </dl>
                {irmExtraction && Object.keys(irmExtraction.candidate_irm_fields || {}).some(key => key.startsWith('avaluo_')) && <div className="irm-valuation">
                  <h3>Desglose del avalúo según documento municipal cargado</h3>
                  <p className="note">Fuente: cédula catastral o IRM aportado por el usuario. Valores extraídos automáticamente, sujetos a revisión; no se mezclan con el avalúo GIS 2024.</p>
                  <p className="note">Las construcciones comunales y adicionales proporcionales a la alícuota corresponden a la participación atribuida al predio en propiedad horizontal, no a una superficie privada adicional.</p>
                  <dl>
                    {[
                      ['avaluo_terreno','Avalúo del terreno'],
                      ['avaluo_cubiertas','Avalúo de construcciones cubiertas'],
                      ['avaluo_abiertas','Avalúo de construcciones abiertas'],
                      ['avaluo_instalaciones','Avalúo de instalaciones especiales'],
                      ['avaluo_comunales_cubiertas','Avalúo de construcciones comunales cubiertas proporcional a la alícuota'],
                      ['avaluo_comunales_abiertas','Avalúo de construcciones comunales abiertas proporcional a la alícuota'],
                      ['avaluo_adicionales','Avalúo de adicionales constructivos proporcional a la alícuota'],
                      ['avaluo_comunal_especial','Avalúo comunal especial'],
                      ['avaluo_total_certificado','Avalúo total del bien inmueble']
                    ].map(([key,label]) => {
                      const raw = irmExtraction.candidate_irm_fields[key]?.raw;
                      const amount = raw ? Number(raw.replace(/,/g,'')) : null;
                      return <React.Fragment key={key}><dt>{label}</dt><dd>{amount !== null && Number.isFinite(amount) ? formatUSD(amount) : 'No extraído'}</dd></React.Fragment>;
                    })}
                  </dl>
                  {(() => {
                    const fields=irmExtraction.candidate_irm_fields;
                    const componentKeys=['avaluo_terreno','avaluo_cubiertas','avaluo_abiertas','avaluo_instalaciones','avaluo_comunales_cubiertas','avaluo_comunales_abiertas','avaluo_adicionales','avaluo_comunal_especial'];
                    const allPresent=componentKeys.every(key=>fields[key]?.raw != null);
                    if (!fields.avaluo_total_certificado?.raw) return <p className="note">No se extrajo el avalúo total del documento; compruebe los valores antes de utilizarlos.</p>;
                    const total=Number(fields.avaluo_total_certificado.raw.replace(/,/g,''));
                    const sum=componentKeys.reduce((acc,key)=>acc+Number((fields[key]?.raw||'0').replace(/,/g,'')),0);
                    return <p className="note">{allPresent ? (Math.abs(sum-total)<0.02 ? 'Desglose verificado aritméticamente contra el total del PDF.' : 'Advertencia: los componentes extraídos no coinciden con el total del PDF; revisar manualmente.') : 'Desglose parcial: no se puede validar la suma hasta extraer todos los componentes.'}</p>;
                  })()}
                </div>}
                <p className="note">Fuente: campos de avalúo del GIS municipal predios_a_2024. Los campos AVALUO_C_1 a AVALUO_C_6 se interpretan según su correspondencia con la cédula catastral; la fuente GIS no publica descripciones detalladas de esos códigos.</p>
                <p className="note">
                  Avalúos catastrales históricos. El valor por m² de terreno
                  se calcula sobre el área atribuida en propiedad horizontal.
                </p>
              </div>
              {/* OPTIONAL CADASTRAL VALUATION — END */}

              {/* OPTIONAL AIVA UI — BEGIN
                  To hide this panel, comment out the JSX block below.
                  Backend AIVA SWITCH separately disables its data lookup.
              */}
              {(properties?._predioai_aiva_2026_usd_m2 != null ||
                properties?._predioai_aiva_2024_usd_m2 != null) && (
                <div className="ph-details">
                  <div className="section-heading">
                    VALOR REFERENCIAL DEL SUELO <span>AIVA</span>
                  </div>
                  <dl>
                    <dt>2024–2025 (USD/m²)</dt>
                    <dd>{formatRate(properties._predioai_aiva_2024_usd_m2)}</dd>
                    <dt>2026–2027 (USD/m²)</dt>
                    <dd>{formatRate(properties._predioai_aiva_2026_usd_m2)}</dd>
                    <dt>Diferencia por m² (2026 menos 2024)</dt>
                    <dd>{typeof properties._predioai_aiva_2026_usd_m2 === 'number' &&
                      typeof properties._predioai_aiva_2024_usd_m2 === 'number'
                      ? formatRate(properties._predioai_aiva_2026_usd_m2 -
                        properties._predioai_aiva_2024_usd_m2)
                      : 'No disponible'}</dd>
                    <dt>Variación porcentual</dt>
                    <dd>
                      {properties._predioai_aiva_change_pct != null &&
                       Number.isFinite(Number(properties._predioai_aiva_change_pct))
                        ? <span className={Number(properties._predioai_aiva_change_pct) > 0
                            ? 'aiva-change-positive'
                            : Number(properties._predioai_aiva_change_pct) < 0
                              ? 'aiva-change-negative' : 'aiva-change-neutral'}>
                            {Number(properties._predioai_aiva_change_pct) > 0 ? '+' : ''}
                            {properties._predioai_aiva_change_pct}%
                          </span>
                        : '—'}
                    </dd>
                    <dt>Avalúo catastral total (2024)</dt>
                    <dd>{typeof properties.avaluo_tot === 'number'
                      ? `${properties.avaluo_tot.toLocaleString('en-US', {minimumFractionDigits: 2})}`
                      : '—'}</dd>
                  </dl>
                  <p className="note">Fuente: AIVA municipal 2024–2025 y 2026–2027 (consulta zonal).</p>
                  <p className="note">
                    AIVA es un valor zonal del terreno, no un precio de
                    mercado ni el avalúo oficial total del inmueble.
                    Consulta por punto; verificar predios que cruzan varias zonas.
                  </p>
                </div>
              )}
              {/* OPTIONAL AIVA UI — END */}

              <p className="source-note">Fuente: Catastro municipal de Quito · atributos catastrales 2024. Geometría 2026 cuando esté disponible. Valores de referencia, no precios comerciales.</p>

              {/* MULTIPLE MATCHES */}

              {data.features.length > 1 && (
                <p className="note">
                  {data.features.length} registros encontrados. Se muestran los datos
                  del primero y los polígonos de todos.
                </p>
              )}

            </div>

          ) : (

            <div className="empty">
              Busque por clave catastral o número de predio
              para consultar los datos municipales
              y ubicar el lote asociado.
            </div>

          )}



          </div>
        </aside>}
        {audience !== 'explorer' && <div className="panel-resize-handle details-resize-handle" role="separator" aria-label="Ajustar ancho del panel de información" aria-orientation="vertical"
          tabIndex={0} aria-valuemin={270} aria-valuemax={680} aria-valuenow={detailsWidth}
          onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setDetailsWidth(w=>Math.max(270,Math.min(680,w+(event.key==='ArrowRight'?20:-20))));}}}
          onPointerDown={event=>startPanelResize(event,'details')} />}

        {/* MAP */}

        <section className={'map-section'+(resultsCollapsed?' results-collapsed':'')}
            style={{'--results-width':(resultsCollapsed?54:resultsWidth)+'px'}}>

          <div className="predio-map-pane">
          <div className="map-top">
            <span className="live">
              MAPA CATASTRAL
            </span>

            <span>
              Mapas base de Esri · Catastro de Quito
            </span>
          </div>

          <ParcelMap data={audience === 'explorer' ? null : data} searchResults={audience==='explorer'?(advancedFilter==='all'?(exploreAllGeometries||visibleExploreGeometries):visibleExploreGeometries):null} selectedSearchPredio={audience==='explorer'?exploreSelected:null} onSelectSearchPredio={selectExplorePredioFromMap} />
          <div className="map-bottom">
            <span>
              Fuente: Catastro 2024 · geometría 2026 cuando disponible · AIVA zonal
            </span>

            <span>
              Límite predial ≠ huella de edificación
            </span>
          </div>
          </div>
          {audience === 'explorer' && !resultsCollapsed && <div className="panel-resize-handle results-resize-handle" role="separator" aria-label="Ajustar ancho del explorador" aria-orientation="vertical"
            tabIndex={0} aria-valuemin={270} aria-valuemax={680} aria-valuenow={resultsWidth}
            onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setResultsWidth(w=>Math.max(270,Math.min(680,w+(event.key==='ArrowLeft'?20:-20))));}}}
            onPointerDown={event=>startPanelResize(event,'results')} />}
          {audience === 'explorer' && <div className="predio-map-reel" id="predio-map-reel">
            <div className="results-panel-tools">
              <button type="button" className="panel-collapse-button" aria-expanded={!resultsCollapsed}
                aria-label={resultsCollapsed?'Expandir explorador de predios':'Contraer explorador de predios'}
                onClick={()=>setResultsCollapsed(value=>!value)}>{resultsCollapsed?'‹':'›'}</button>
              {resultsCollapsed&&<span className="collapsed-panel-caption">Predios</span>}
            </div>
            <div className="results-panel-content">
            {error && <p className="error" role="alert">{error}</p>}
            {exploreError && <p className="error" role="alert">{exploreError}</p>}
            {exploreMapNotice&&<p className="note" role="status">{exploreMapNotice}</p>}
            {exploreCount!==null&&<button type="button" className="predio-new-query" disabled={exploreBusy} onClick={clearGISExploration}>Limpiar búsqueda · Nueva consulta ↑</button>}
            {exploreSelected && <section className="selection-detail" aria-label="Predio seleccionado">
              <div><span className="eyebrow">PREDIO SELECCIONADO</span><strong>Predio {exploreSelected}</strong><p>{selectedExploreParcel?.parroquia || 'Quito'}{selectedExploreParcel?.area_terre != null ? ` · ${formatArea(Number(selectedExploreParcel.area_terre))} de lote` : ''}</p></div>
              <div className="selection-actions"><button type="button" className="primary-action" disabled={loading} onClick={() => openExplorePredio(exploreSelected)}>{loading ? 'Abriendo ficha…' : 'Abrir ficha →'}</button>
              <button type="button" className="secondary" disabled={!selectedExploreParcel || savedParcels.some(p => p.n_predio === exploreSelected)} onClick={() => saveParcel(selectedExploreParcel)}>{savedParcels.some(p => p.n_predio === exploreSelected) ? 'Guardado en selección ✓' : 'Guardar en selección +'}</button></div>
            </section>}
            {exploreResults.length>0 ? <>
          <div className="predio-reel-heading">
            <div>
              <strong>{exploreCount?.toLocaleString('es-EC')} predios encontrados</strong>
              {Object.keys(advancedRows).length>0&&<p className="note">PUGS: {Object.keys(advancedRows).length} comparados · filtro: {advancedFilter==='all'?'Todos':advancedFilter} · {visibleExploreResults.length} visibles</p>}
              <div className="predio-selection-controls">
                <span className="predio-selection-indicator">{exploreSelected?'Seleccionado: '+exploreSelected:'Ningún predio seleccionado'}</span>
                {exploreSelected&&<button type="button" className="predio-clear-selection" onClick={()=>setExploreSelected(null)}>Quitar selección</button>}
              </div>
              <p className="note">Selecciona una tarjeta para ver el predio en el mapa y abrir su ficha.</p>
            </div>
            <label className="predio-reel-sort">Ordenar por
              <select value={exploreSort} disabled={exploreBusy} onChange={e=>{
                const next=e.target.value;
                setExploreSort(next);
                exploreParcels(0,next);
              }}>
                <option value="id">Número de predio</option>
                <option value="largest">Mayor a menor superficie</option>
                <option value="smallest">Menor a mayor superficie</option>
              </select>
            </label>
            <label className="predio-page-size">Predios por página
              <select value={explorePageSize} disabled={exploreBusy}
                onChange={e=>{
                  const size=Number(e.target.value);
                  if(reelColumns===1)setListPageSize(size);else setIconPageSize(size);
                  if(exploreCount!==null)exploreParcels(0,exploreSort,size);
                }}>
                {(reelColumns===1?[50,100]:[100,200]).map(size=><option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <div className="predio-card-view" role="group" aria-label="Distribución de tarjetas">
              <span>Vista</span>
              <button type="button" disabled={exploreBusy} className={reelColumns===1?'active':''} aria-pressed={reelColumns===1} onClick={()=>{if(reelColumns!==1){setReelColumns(1);if(exploreCount!==null)exploreParcels(0,exploreSort,listPageSize);}}}><span aria-hidden="true">☰ </span>Lista</button>
              <button type="button" disabled={exploreBusy} className={reelColumns===2?'active':''} aria-pressed={reelColumns===2} onClick={()=>{if(reelColumns!==2){setReelColumns(2);if(exploreCount!==null)exploreParcels(0,exploreSort,iconPageSize);}}}><span aria-hidden="true">▦ </span>Iconos</button>
            </div>
          </div>
          <nav className="predio-reel-pagination" aria-label="Navegar páginas de predios">
            <button type="button" className="secondary" disabled={exploreBusy||exploreQueryKey!==explorationFilterKey||exploreOffset===0}
              onClick={()=>exploreParcels(Math.max(0,exploreOffset-explorePageSize))}>Anterior</button>
            <span className="predio-reel-page" aria-live="polite">
              {exploreCount===null?'Sin resultados':`${(exploreResults.length?exploreOffset+1:0).toLocaleString('es-EC')}–${(exploreOffset+exploreResults.length).toLocaleString('es-EC')} / ${exploreCount.toLocaleString('es-EC')}`}
            </span>
            <button type="button" className="secondary" disabled={exploreBusy||exploreQueryKey!==explorationFilterKey||exploreCount===null||exploreOffset+explorePageSize>=exploreCount}
              onClick={()=>exploreParcels(exploreOffset+explorePageSize)}>Siguientes {explorePageSize}</button>
          </nav>
          {advancedFilter!=='all'&&visibleExploreResults.length===0&&<p className="note">No hay coincidencias indicativas para esta clasificación entre los predios de la página actual. Pruebe otro filtro o consulte el IRM.</p>}
          <div id="predio-results-reel" className={'predio-results-reel '+(reelColumns===2?'icon-grid':'one-column')} role="group" aria-label="Resultados catastrales ordenados">
            {visibleExploreResults.map((p,i)=>{
              const id=String(p.n_predio);
              const active=exploreSelected===id;
              const resultIsPH=String(p.tipo_propi||'').trim().toUpperCase()==='PROPIEDAD HORIZONTAL';
              const hasGeometry=Boolean(exploreGeometries?.features?.some(f=>String(f.properties?.n_predio)===id));
              const landArea=p.area_terre===null||p.area_terre===undefined?null:Number(p.area_terre);
              const builtArea=p.area_const===null||p.area_const===undefined?null:Number(p.area_const);
              const validLand=landArea!==null&&Number.isFinite(landArea)&&landArea>0;
              const validBuilt=builtArea!==null&&Number.isFinite(builtArea)&&builtArea>=0;
              const fmt=value=>Number(value).toLocaleString('es-EC',{maximumFractionDigits:2});
              const ratio=validLand&&validBuilt?100*builtArea/landArea:null;
              return <button type="button" key={id+'-'+i}
                className={'predio-reel-card'+(active?' selected':'')+(reelColumns===2&&active?' is-flipped':'')}
                data-predio-id={id}
                aria-pressed={active}
                aria-expanded={reelColumns===2?active:undefined}
                aria-label={`Predio ${id}, ${p.parroquia||'sin parroquia'}, ${validLand?fmt(landArea):'superficie no disponible'} metros cuadrados de terreno. ${hasGeometry?'Ubicar polígono en mapa':'Sin geometría disponible'}`}
                title={`Predio ${id} · ${p.parroquia||'Sin parroquia'}`}
                onClick={()=>toggleExplorePredio(id)}>
                {reelColumns===2 ? <span className="predio-flip-inner">
                  <span className="predio-flip-front" aria-hidden={active}>
                    <span className="predio-icon-symbol" aria-hidden="true">▧</span>
                    <span className="predio-icon-id">Predio {id}</span>
                    <span className="predio-icon-area">{validLand?fmt(landArea):'—'} m²</span>
                  </span>
                  <span className="predio-flip-back" aria-hidden={!active}>
                    <span className="predio-flip-title">{p.parroquia||'Sin parroquia'}</span>
                    <span>Terreno: {validLand?fmt(landArea)+' m²':'—'}</span>
                    <span>Construido: {validBuilt?fmt(builtArea)+' m²':'—'}</span>
                    <span>Relación: {ratio!==null?ratio.toLocaleString('es-EC',{maximumFractionDigits:1})+'%':'—'}</span>
                    {advancedRows[id]&&<span>PUGS: {advancedRows[id].code}</span>}
                  </span>
                </span> : <>
                  <span className="predio-reel-card-top"><span>Predio {id}</span><span className="predio-reel-index">{exploreOffset+i+1}</span></span>
                  <span className="predio-reel-parish">{p.parroquia||'Parroquia no indicada'}</span>
                  <span className="predio-reel-area">{validLand?fmt(landArea):'—'} <small>{resultIsPH?'m² de lote matriz':'m² de terreno'}</small></span>
                  <span className="predio-reel-area-comparison">
                    <span>Área construida <strong>{validBuilt?fmt(builtArea)+' m²':'No disponible'}</strong></span>
                    <span>Construcción / terreno <strong>{ratio!==null?ratio.toLocaleString('es-EC',{maximumFractionDigits:1})+'%':'No disponible'}</strong></span>
                  </span>
                  <span className="predio-reel-metadata">{hasGeometry?'Polígono disponible':'Geometría no disponible'}</span>
                  {advancedRows[id]&&<span className="predio-pugs-evidence">PUGS: {advancedRows[id].code} · {advancedRows[id].detail}</span>}
                  <span className="predio-reel-status">{active?'● Seleccionado · clic para quitar':hasGeometry?'Ver en mapa':'Ver ficha catastral'}</span>
                </>}
              </button>;
            })}
          </div>
          <nav className="predio-reel-pagination" aria-label="Navegar páginas de predios">
            <button type="button" className="secondary" disabled={exploreBusy||exploreQueryKey!==explorationFilterKey||exploreOffset===0}
              onClick={()=>exploreParcels(Math.max(0,exploreOffset-explorePageSize))}>Anterior</button>
            <span className="predio-reel-page" aria-live="polite">
              {exploreCount===null?'Sin resultados':`${(exploreResults.length?exploreOffset+1:0).toLocaleString('es-EC')}–${(exploreOffset+exploreResults.length).toLocaleString('es-EC')} / ${exploreCount.toLocaleString('es-EC')}`}
            </span>
            <button type="button" className="secondary" disabled={exploreBusy||exploreQueryKey!==explorationFilterKey||exploreCount===null||exploreOffset+explorePageSize>=exploreCount}
              onClick={()=>exploreParcels(exploreOffset+explorePageSize)}>Siguientes {explorePageSize}</button>
          </nav>
            </> : <div className="predio-reel-empty explorer-empty" role="status">
              <span className="empty-map-symbol" aria-hidden="true">▧</span>
              <strong>{exploreBusy ? 'Buscando coincidencias…' : exploreError ? 'La búsqueda no pudo completarse' : exploreCount === 0 ? 'No encontramos coincidencias' : 'El territorio, a tu alcance.'}</strong>
              <p>{exploreBusy ? 'Consultando atributos y límites catastrales. Puedes seguir explorando el mapa.' : exploreError ? 'Tus criterios se conservan. Pulsa Buscar predios para intentarlo de nuevo.' : exploreCount === 0 ? 'Amplía el rango de superficie o quita algún filtro para explorar más alternativas.' : 'Define tus criterios y busca. Aquí verás los predios para revisar su ficha o agregarlos a tu selección.'}</p>
              {exploreCount === 0 && <button type="button" className="secondary" onClick={() => {setExploreSearchOpen(true); document.getElementById('predio-query-selector')?.scrollIntoView({behavior:scrollBehavior()});}}>Ajustar criterios</button>}
            </div>}
            </div>
          </div>}




        </section>

      </section>)}
      {step === 'project' && properties && audience === 'developer' && (
        <section className="workspace-page planning-workspace">
          <div className="workspace-heading"><div>
            <span className="eyebrow">NUEVA CONSTRUCCIÓN · PASO 2</span>
            <h1>Evaluación preliminar · Predio {properties.n_predio || identifier}</h1>
            <p>Seleccione si desea construir en un predio individual o evaluar un terreno para desarrollar varios lotes.</p>
          </div></div>
          <section className="property">
            <h2>¿Qué tipo de terreno desea evaluar?</h2>
            <div className="audience-options" role="group" aria-label="Objetivo del terreno">
              <button type="button" className={landGoal === 'individual' ? 'active' : ''} aria-pressed={landGoal === 'individual'}
                onClick={() => {setLandGoal('individual');setDevelopmentType('single');}}>Predio individual / vivienda propia</button>
              <button type="button" className={landGoal === 'develop' ? 'active' : ''} aria-pressed={landGoal === 'develop'}
                onClick={() => {setLandGoal('develop');setDevelopmentType('multiple');}}>Desarrollar terreno / varios lotes</button>
            </div>
            <h3>Datos del catastro municipal</h3>
            <dl>
              <dt>Régimen de propiedad</dt><dd>{lotProfile.ownership}</dd>
              <dt>Estado del lote (catastro)</dt><dd>{lotProfile.status}</dd>
              <dt>Uso de construcción registrado</dt><dd>{lotProfile.use}</dd>
              <dt>Destino económico registrado</dt><dd>{lotProfile.landUse}</dd>
              <dt>Área del predio (catastro)</dt><dd>{cadastralAreaValue ? formatArea(Number(cadastralAreaValue)) : 'No disponible'}</dd>
              {irmExtraction?.candidate_irm_fields?.area_terreno?.raw && <>
                <dt>{isCadastralPH ? 'Área según IRM (lote matriz)' : 'Área según IRM'}</dt>
                <dd>{formatArea(Number(irmExtraction.candidate_irm_fields.area_terreno.raw.replace(',', '.')))}</dd>
              </>}
              <dt>Superficie del lote matriz</dt><dd>{formatArea(lotProfile.landArea)}</dd>
              <dt>Frente registrado</dt><dd>{typeof lotProfile.frontage === 'number' ? `${lotProfile.frontage} m` : 'No disponible'}</dd>
              <dt>Construcción registrada</dt><dd>{formatArea(lotProfile.constructionArea)}</dd>
              <dt>Fecha de escritura (catastro)</dt><dd>{formatMunicipalDate(properties.fecha_escr)}</dd>
              <dt>Fecha de inscripción (catastro)</dt><dd>{formatMunicipalDate(properties.fecha_insc)}</dd>
              <dt>Año de construcción</dt><dd>{constructionYear ?? 'No disponible en la fuente verificada'}</dd>
            </dl>
            {existingConstruction && <p className="note">Existe superficie de construcción registrada en el catastro. Esto no confirma la fecha de construcción ni la existencia de una licencia municipal.</p>}
            <p className="note">{isPH ? 'El predio corresponde a propiedad horizontal: el área del lote matriz no representa un terreno independiente disponible para subdivisión.' : 'El registro catastral no confirma por sí solo si el lote es independiente, está vacío o admite subdivisión.'}</p>
            <p className="note">Estos datos describen el predio existente. La posibilidad de construir viviendas, edificios o fraccionar el terreno depende del IRM y de la normativa aplicable.</p>
          </section>
          <section className="property developer-irm-panel">
            <h2>Consulta del IRM</h2>
            <p>Número de predio: <strong>{properties.n_predio || 'No disponible'}</strong></p>
            <div className="irm-number-row">
              <input aria-label="Número de predio para IRM" readOnly value={String(properties.n_predio || '')} onFocus={event => event.target.select()} />
              <button type="button" className="secondary" onClick={copyIrmPredio}>Copiar número</button>
            </div>
            {irmCopyStatus && <p role="status" className="note">{irmCopyStatus}</p>}
            <button type="button" className="secondary" disabled={irmBridgeBusy} onClick={startIrmDesktop}>{irmBridgeBusy ? 'Conectando…' : 'Consulta asistida en escritorio'}</button>
                    <a className="irm-open-link" href="https://pam.quito.gob.ec/mdmq_web_irm/irm/buscarPredio.jsf" target="_blank" rel="noopener noreferrer">Abrir consulta IRM oficial ↗</a>
            <p className="note">Complete el CAPTCHA manualmente. La consulta asistida requiere iniciar el puente local en su computadora. Si no está disponible, utilice el enlace oficial y pegue el número manualmente.</p>
            <details><summary>Consulta asistida desde computadora</summary>
              <p>El prototipo local puede abrir el portal y esperar la verificación manual.</p>
              <a href="https://github.com/jayjayanton/Predio-AI/blob/main/automation/README.md" target="_blank" rel="noopener noreferrer">Instrucciones de Playwright ↗</a>
            </details>
            <label htmlFor="developer-irm-upload"><strong>Adjuntar IRM obtenido (PDF)</strong></label>
            <input id="developer-irm-upload" type="file" accept=".pdf,application/pdf" onChange={event => uploadDeveloperIrm(event.target.files?.[0] || null)} />
            {irmExtracting && <p role="status">Extrayendo parámetros del IRM…</p>}
            {irmExtractError && <p role="alert" className="error">{irmExtractError}</p>}
            {developerIrm && <p role="status">Archivo seleccionado: {developerIrm.name}</p>}


          <p className="note">El IRM se contrasta con la zonificación PUGS para contextualizar qué tipos de construcción pueden permitirse en el área. La compatibilidad normativa y la factibilidad del predio se evalúan por separado.</p>
          </section>
          <section className="property">
            <h2>Factibilidad del predio</h2>
            {!irmExtraction ? <p className="note">Cargue el IRM para revisar las condiciones del predio y calcular su potencial constructivo.</p> : <>
              <p><strong>{parcelFeasibility}</strong></p>
              {irmHasLandUse && <div className="zoning-classification">
                <h3>Uso de suelo general y específico (IRM)</h3>
                {irmPugsAssignments.map((assignment,index) => {
                  const matching = pugsZones.filter(zone => {
                    const label=[zone.tipologia,zone.uso_prin,zone.leyenda,zone.tipo_des].filter(Boolean).join(' ').toUpperCase();
                    return label.split(/[^A-Z0-9-]+/).includes(assignment.code.toUpperCase());
                  });
                  return <div key={assignment.code+'-'+index} className="irm-evidence-item">
                    <p><strong>Uso de suelo general:</strong> {assignment.generalUse || 'No extraído'}{assignment.generalDescription ? ' — '+assignment.generalDescription : ''}</p>
                    <p><strong>Uso de suelo específico:</strong> {assignment.code}{assignment.description ? ' — '+assignment.description : ''}{assignment.isProtection ? ' · Protección ecológica' : ''}</p>
                    <p className="note">{[
                      assignment.classification ? 'Clasificación '+assignment.classification : null,
                      assignment.pit ? 'PIT '+assignment.pit : null,
                      assignment.buildability ? 'Edificabilidad '+assignment.buildability : null
                    ].filter(Boolean).join(' · ')}</p>
                    {matching.some(zone => zone._overlap_m2 != null) && <p className="note">
                      Intersección GIS del lote matriz: {matching.filter(zone => zone._overlap_m2 != null).map(zone => formatArea(Number(zone._overlap_m2)) + (zone._overlap_percent != null ? ' ('+zone._overlap_percent+'%)' : '')).join(' + ')}.
                    </p>}
                  </div>;
                })}
                <p className="note">El IRM documenta las asignaciones, pero no indica por sí solo qué superficie corresponde a cada una. Las superficies GIS son cruces provisionales sobre el polígono catastral; no se atribuyen a la unidad PH.</p>
              </div>}

              {(() => {
                const f=irmExtraction?.candidate_irm_fields || {};
                const rows=[
                  ['clasificacion_suelo','Clasificación de suelo'],
                  ['subclasificacion_suelo','Subclasificación'],
                  ['tratamiento','Tratamiento urbanístico'],
                  ['pit','Polígono de intervención territorial (PIT)'],
                  ['forma_ocupacion','Forma de ocupación'],
                  ['retiro_frontal','Retiro frontal','m'],
                  ['retiro_lateral','Retiro lateral','m'],
                  ['retiro_posterior','Retiro posterior','m'],
                  ['entre_bloques','Separación entre bloques','m'],
                  ['altura_pisos','Altura de edificación','m'],
                  ['servicios_basicos','Factibilidad de servicios básicos']
                ].filter(([key])=>f[key]?.raw);
                return rows.length ? <div className="zoning-buildability">
                  <h3>Condiciones urbanísticas adicionales del IRM</h3>
                  <p className="note">Parámetros documentados en APROVECHAMIENTO URBANÍSTICO (PUGS). No se repiten aquí COS, pisos, lote ni frente mínimo, que se muestran en el cuadro de capacidad.</p>
                  <dl>{rows.map(([key,label,unit])=><React.Fragment key={key}>
                    <dt>{label}</dt><dd>{f[key].raw}{unit ? ' '+unit : ''}</dd>
                  </React.Fragment>)}</dl>
                  <p className="note">Extracción automática pendiente de revisión con el PDF municipal.</p>
                </div> : null;
              })()}
              {!irmHasLandUse && zoningClassifications.length > 0 && <div className="zoning-classification">
                <strong>{singleZoningClassification ? 'Clasificación PUGS:' : 'Clasificaciones PUGS:'}</strong>
                {zoningClassifications.map((zone, i) => <p key={zone.OBJECTID || i}>
                  {[zone.uso_prin, zone.leyenda].filter(value => value != null && String(value).trim() !== '').join(' - ') || 'Clasificación no disponible'}
                </p>)}
              </div>}
              {(basicBuildability.length > 0 || irmExtraction?.candidate_irm_fields?.codigo_municipal_edificabilidad) && <div className="zoning-buildability">
                <h3>Edificabilidad básica (PUGS)</h3>
                {(() => {
                  const fields = irmExtraction?.candidate_irm_fields || {};
                  const municipalCode = fields.codigo_municipal_edificabilidad?.raw || basicBuildability[0]?.designation || basicBuildability[0]?.code || null;
                  const descriptiveCode = fields.codigo_edificabilidad_basica?.raw || null;
                  // The municipal code may have a parenthetical suffix (e.g. VU).
                  // Use a non-conditional explanation for every extracted code;
                  // explicit IRM values take priority over inferred code segments.
                  const cleanCode = String(descriptiveCode || '').trim().toUpperCase();
                  const match = cleanCode.match(/^([A-Z])(\d{3,5})(\d)-([\d.,]+)(?:\s*\([^)]*\))?$/);
                  const occupation = fields.forma_ocupacion?.raw || (match?.[1] === 'A' ? 'Aislada' : null);
                  const lot = fields.lote_minimo?.raw || (match ? String(Number(match[2])) : null);
                  const floors = fields.pisos?.raw || match?.[3] || null;
                  const cos = fields.cos_pb?.raw || match?.[4] || null;
                  const description = [
                    occupation ? `Forma de ocupación: ${occupation}` : null,
                    lot ? `Lote mínimo: ${Number(String(lot).replace(/,/g, '')).toLocaleString('es-EC')} m²` : null,
                    floors ? `Número de pisos: ${floors}` : null,
                    cos ? `COS PB: ${cos}%` : null
                  ].filter(Boolean).join(' · ');
                  return <>
                    <p><strong>Código municipal</strong></p>
                    <p>{municipalCode || 'No disponible'}</p>
                    <p><strong>CÓDIGO DE EDIFICABILIDAD BÁSICA</strong></p>
                    <p>{descriptiveCode || 'No identificado en el IRM'}</p>
                    {(() => {
                      const suffix=String(descriptiveCode || '').match(/\(([A-Z]{2,5})\)\s*$/)?.[1];
                      const meanings={VU:'Vivienda unifamiliar',VB:'Vivienda bifamiliar',VM:'Vivienda multifamiliar'};
                      return suffix ? <p><strong>Tipo de vivienda ({suffix}):</strong> {meanings[suffix] || 'Sufijo no definido; verificar normativa municipal.'}</p> : null;
                    })()}
                    {descriptiveCode && <p className="note"><strong>Descripción de edificabilidad básica:</strong> {description || 'Código municipal identificado; sus parámetros detallados no pudieron interpretarse automáticamente. Consulte la tabla del IRM.'} Los valores documentados en el IRM prevalecen sobre la interpretación del código.</p>}
                    {!descriptiveCode && <p className="note">El código descriptivo debe confirmarse en el IRM; no se deduce a partir del identificador municipal.</p>}
                  </>;
                })()}
              </div>}
              {(protectedZones.length > 0 || ravineRestriction || forestRestriction) && <div className="inspection">
                <strong>Restricciones territoriales identificadas</strong>
                {protectedZones.map((zone,i) => <p key={zone.OBJECTID || i}>Zona de protección: {zone.leyenda || zone.tipo_des || zone.uso_prin || 'PE'}{zone._overlap_percent != null ? ` — ${zone._overlap_percent}% del lote matriz` : ''}. No aplicar aquí los parámetros constructivos de RUB-2.</p>)}
                {ravineRestriction && <p>El IRM menciona quebrada y protección geográfica. La ubicación y el retiro definitivo requieren verificación municipal.</p>}
                {forestRestriction && <p>El IRM menciona protección forestal. Debe verificarse la delimitación y normativa aplicable.</p>}
                <p className="note">El cruce corresponde al polígono catastral disponible; no localiza automáticamente la unidad individual de propiedad horizontal.</p>
              </div>}
              {developerAreaSource && <p className="note">{developerAreaSource}</p>}
              <div className="capacity-inputs">
                <div><strong>Área real del predio (catastro)</strong><p>{cadastralAreaValue ? formatArea(Number(cadastralAreaValue)) : 'No disponible'}</p></div>
                <div><strong>{isCadastralPH ? 'Área según IRM (lote matriz)' : 'Área según IRM'}</strong><p>{irmExtraction?.candidate_irm_fields?.area_terreno?.raw ? formatArea(Number(irmExtraction.candidate_irm_fields.area_terreno.raw.replace(',', '.'))) : 'No extraída'}</p></div>
                <div><strong>Lote mínimo (IRM)</strong><p>{irmValues.minLot ? formatArea(Number(irmValues.minLot)) : 'No extraído'}</p></div>
                <div><strong>Frente mínimo (IRM)</strong><p>{irmValues.minFront ? `${irmValues.minFront} m` : 'No extraído'}</p></div>
                <div><strong>COS PB / total</strong><p>{irmValues.cosPb !== '' ? `${irmValues.cosPb}%` : '—'} / {irmValues.cosTotal !== '' ? `${irmValues.cosTotal}%` : '—'}</p></div>
                <div><strong>Pisos (IRM)</strong><p>{irmValues.floors || 'No extraído'}</p></div>
                {!isCadastralPH && Number(irmValues.area) > 0 && Number(irmValues.minLot) > 0 && <div><strong>Máximo teórico de lotes por área</strong><p>{Math.floor(Number(irmValues.area) / Number(irmValues.minLot))} (sin descontar vías ni cesiones)</p></div>}
              </div>
              {isCadastralPH && <p className="note">Propiedad horizontal: el área del lote matriz no representa derechos constructivos independientes de esta unidad.</p>}
              <p className="note">Parámetros documentados en el IRM y cálculos de PredioAI basados en las áreas disponibles. La aplicación no sustituye la verificación de restricciones ni la autorización municipal.</p>
            {irmImages.length > 0 && <div className="irm-evidence">
              <h3>Mapas y afectaciones relevantes del IRM</h3>
              <p className="note">Imágenes del PDF aportado; se muestran únicamente cuando se detectan referencias textuales a afectaciones o protección. No sustituyen un levantamiento georreferenciado.</p>
              {irmImages.map(item => <div key={item.key} className="irm-evidence-item">
                <h4>{item.title} · {item.key === 'occupation_diagram' ? `imagen en página ${item.imagePage}` : `texto en página(s) ${item.sourcePages.join(', ')}`}</h4>
                <p>{item.key === 'occupation_diagram' ? 'Esquema municipal de implantación y retiros. Los parámetros numéricos figuran en la sección de condiciones urbanísticas.' : (item.mapDescription || item.finding)}</p>
                {item.key === 'proteccion' && <div className="note">
                  <strong>Superficie afectada según cruce PUGS:</strong>{' '}
                  {protectedZones.some(zone => Number.isFinite(Number(zone._overlap_m2)) && zone._overlap_m2 != null)
                    ? protectedZones.filter(zone => zone._overlap_m2 != null && Number.isFinite(Number(zone._overlap_m2))).map((zone,index) =>
                        <span key={zone.OBJECTID || index}>
                          {index > 0 ? '; ' : ''}
                          {zone.leyenda || zone.tipo_des || zone.uso_prin || 'PE'}: {formatArea(Number(zone._overlap_m2))}
                          {zone._overlap_percent != null ? ` (${Number(zone._overlap_percent).toLocaleString('es-EC')}% del polígono catastral)` : ''}
                        </span>)
                    : 'No cuantificada: el IRM identifica protección ecológica, pero no se dispone de una intersección espacial válida.'}
                  <p className="note">Medición provisional por intersección de polígonos PUGS y geometría catastral. En propiedad horizontal corresponde al lote matriz, no a la superficie exclusiva de la unidad. El cálculo no delimita por sí solo el retiro legal ni acredita la superficie edificable.</p>
                </div>}
                {item.key === 'quebrada' && <p className="note"><strong>Superficie de protección de quebrada:</strong> no cuantificada. El IRM identifica la quebrada abierta y exige definir el borde superior y retiro definitivo con la autoridad municipal. La imagen es referencial y no permite calcular con precisión el área restringida.</p>}
                {item.key === 'fallas' && <p className="note"><strong>Área afectada por falla:</strong> no cuantificada. Se requiere una capa geológica oficial con delimitación espacial verificable.</p>}
                {item.key === 'forestal' && <p className="note"><strong>Área de protección forestal:</strong> no cuantificada con la información disponible. No debe equipararse automáticamente a la zona PE ni a las áreas protegidas visibles en el mapa.</p>}
                {item.image && <figure><img src={item.image} alt={`Mapa de referencia del IRM, página ${item.imagePage}: ${item.title}`} loading="lazy" style={{width:'100%',maxWidth:'520px',height:'auto'}} /><figcaption>Recorte del mapa oficial, página {item.imagePage} del PDF original.</figcaption></figure>}
                <p className="note">{item.note}</p>
              </div>)}
            </div>}
              <section className="zoning-buildability" aria-label="Simbología PUGS">
                <h3>Simbología y códigos PUGS</h3>
                <p className="note">Glosario de referencia del PUGS de Quito. Los códigos siguientes no significan que todos estos usos estén asignados al predio. La asignación efectiva consta arriba en «Uso de suelo general y específico (IRM)».</p>
                <h4>Usos de suelo generales</h4>
                <dl>
                  {[
                    ['R','Residencial'],['M','Múltiple'],['PC','Patrimonio Cultural'],
                    ['E','Equipamiento'],['I','Industrial'],['PE','Protección Ecológica'],
                    ['CSE','Comercios y Servicios Especializados'],['SE','Suelo de Expansión'],
                    ['RNR','Recurso Natural Renovable'],['RNNR','Recurso Natural No Renovable']
                  ].map(([code,label])=><React.Fragment key={code}><dt>{code}</dt><dd>{label}</dd></React.Fragment>)}
                </dl>
                <h4>Usos de suelo específicos y tipologías</h4>
                <dl>
                  {[
                    ['RUB','Residencial urbano de baja densidad (tipos 1–3)'],
                    ['RUM','Residencial urbano de media densidad (tipos 2–4)'],
                    ['RUA','Residencial urbano de alta densidad (tipos 3–4)'],
                    ['RR','Residencial Rural'],['RRR','Residencial Rural Restringido'],
                    ['PE','Protección Ecológica'],['PA','Protección Arqueológica'],
                    ['PUP','Protección Urbana Patrimonial'],['E','Equipamiento'],
                    ['M','Múltiple'],['CSE','Comercios y Servicios Especializados'],
                    ['IAI','Industrial Alto Impacto'],['IMI','Industrial Medio Impacto'],
                    ['IAR','Industrial Alto Riesgo'],['RNR','Recurso Natural Renovable'],
                    ['RNNR','Recurso Natural No Renovable'],['SR','Suelo de Reserva']
                  ].map(([code,label])=><React.Fragment key={code}><dt>{code}</dt><dd>{label}</dd></React.Fragment>)}
                </dl>
                <p className="note">Fuente: <a href="https://habitat.quito.gob.ec/wp-content/uploads/2025/07/MANUAL-PUGS.pdf" target="_blank" rel="noopener noreferrer">Manual PUGS — Secretaría de Hábitat de Quito</a>. Los tipos y compatibilidades concretas deben verificarse en la ordenanza y sus anexos vigentes.</p>
              </section>
              <section className="zoning-buildability" aria-label="Sufijos de edificabilidad">
                <h3>Sufijos de edificabilidad y vivienda</h3>
                <p className="note">Los sufijos entre paréntesis del código de edificabilidad no son equivalentes al uso de suelo general o específico.</p>
                <dl>
                  <dt>VU</dt><dd>Vivienda unifamiliar</dd>
                  <dt>VB</dt><dd>Vivienda bifamiliar</dd>
                  <dt>VM</dt><dd>Vivienda multifamiliar</dd>
                </dl>
                <p className="note">Estas denominaciones no autorizan por sí solas un número de viviendas. Deben contrastarse con el área mínima, la asignación territorial y los requisitos municipales. No se presume que VU, VB y VM sean todos los sufijos posibles.</p>
                <p className="note">Referencia normativa: <a href="https://habitat.quito.gob.ec/wp-content/uploads/2025/07/ORD-003-2024-PMDOT-PUGS.pdf" target="_blank" rel="noopener noreferrer">Ordenanza PMDOT-PUGS 003-2024</a>.</p>
              </section>
              <ResidentialSimulator
                area={irmValues.area}
                minLot={irmValues.minLot}
                minFront={irmValues.minFront}
                cosPb={irmValues.cosPb}
                cosTotal={irmValues.cosTotal}
                floors={irmValues.floors}
                setbacks={{
                  front:irmExtraction?.candidate_irm_fields?.retiro_frontal?.raw,
                  rear:irmExtraction?.candidate_irm_fields?.retiro_posterior?.raw,
                  lateral:irmExtraction?.candidate_irm_fields?.retiro_lateral?.raw,
                  blocks:irmExtraction?.candidate_irm_fields?.entre_bloques?.raw
                }}
                suffix={irmExtraction?.candidate_irm_fields?.codigo_edificabilidad_basica?.raw?.match(/\(([A-Z]{2,5})\)\s*$/)?.[1] || null}
                isPH={isCadastralPH}
              />
              <div className="potential-results">
                <h3>Potencial constructivo estimado</h3>
            <label className="irm-confirm"><input type="checkbox" checked={irmConfirmed} onChange={e => setIrmConfirmed(e.target.checked)} />
              He revisado los valores, el uso de suelo y las restricciones en el IRM oficial.
            </label>
            {capacityReady && irmConfirmed ? <div className="capacity-results" role="status">
              <h3>Capacidad teórica según COS</h3>
              <p>Ocupación máxima de planta baja por COS: <strong>{formatArea(Number(irmValues.area) * Number(irmValues.cosPb) / 100)}</strong></p>
              <p>Superficie total computable por COS: <strong>{formatArea(Number(irmValues.area) * Number(irmValues.cosTotal) / 100)}</strong></p>
              <p>Pisos indicados en IRM: <strong>{irmValues.floors}</strong></p>
              <p className="note">Proyecto seleccionado: {developmentType === 'single' ? 'Una vivienda' : developmentType === 'multiple' ? 'Varias viviendas' : developmentType === 'subdivision' ? 'Subdivisión de terreno' : 'Edificio multifamiliar'}.</p>
              {!isCadastralPH && (developmentType === 'multiple' || developmentType === 'subdivision') && Number(irmValues.minLot) > 0 && <p><strong>Máximo teórico por área: {Math.floor(Number(irmValues.area) / Number(irmValues.minLot))} lotes</strong> de al menos {irmValues.minLot} m², antes de descontar vías, cesiones, accesos y otras exigencias. No es el número de viviendas autorizado.</p>}
              {!isCadastralPH && Number(irmValues.minLot) > 0 && <p>En un lote mínimo de {irmValues.minLot} m², el COS PB correspondería a {formatArea(Number(irmValues.minLot) * Number(irmValues.cosPb) / 100)} de ocupación en planta baja y el COS total a {formatArea(Number(irmValues.minLot) * Number(irmValues.cosTotal) / 100)} de superficie computable, sujetos a retiros y otras restricciones.</p>}
              {Number(irmValues.minFront) > 0 && <p>Frente mínimo indicado: {irmValues.minFront} m. Su cumplimiento geométrico aún no se comprueba.</p>}
              {irmValues.dwellingCode && <p>Designación detectada: {irmValues.dwellingCode}. Debe confirmarse su significado y aplicación en la normativa vigente.</p>}
              <p className="note"><strong>Información comprobable del IRM:</strong> {[
                irmHasLandUse ? 'uso de suelo ('+irmPugsAssignments.map(item=>item.code).join(', ')+')' : null,
                irmHasSetbacks ? 'retiros frontal, lateral y posterior' : null,
                irmHasFrontage ? 'frente mínimo' : null,
                irmValues.cosPb !== '' ? 'COS PB y COS total' : null,
                irmValues.floors ? 'número de pisos' : null
              ].filter(Boolean).join(' · ') || 'No se identificaron parámetros suficientes'}.</p>
              {irmHasMultipleZoning && <p className="note">El IRM contiene varias asignaciones de suelo. La clasificación residencial no se extiende automáticamente a la zona de protección ecológica; se requiere ubicar la intervención dentro del lote.</p>}
              <p className="note"><strong>Validaciones pendientes:</strong> {[
                !irmHasLandUse ? 'extraer uso de suelo del IRM' : null,
                !irmHasSetbacks ? 'completar retiros documentados' : null,
                !irmHasFrontage ? 'verificar frente mínimo' : null,
                'compatibilidad específica del proyecto y densidad permitida',
                'cumplimiento geométrico de retiros, accesos y afectaciones',
                isCadastralPH ? 'derechos y autorizaciones de propiedad horizontal' : null,
                'autorización municipal aplicable'
              ].filter(Boolean).join('; ')}. La información del IRM no equivale a una aprobación automática de viviendas o apartamentos.</p>
            </div> : <p className="note">No hay suficientes parámetros verificables para calcular. En propiedad horizontal se requiere confirmar el alcance del IRM: el COS del lote matriz no debe aplicarse automáticamente a la superficie atribuida de una unidad.</p>}


              </div>
            </>}
          </section>



          <button type="button" className="secondary" onClick={() => setStep('property')}>← Volver al predio</button>
        </section>
      )}
      {step === 'project' && audience === 'remodeler' && (
        <section className="workspace-page">
          <div className="workspace-heading"><div><span className="eyebrow">PASO 1 · PLANOS Y ACTIVIDADES</span><h2>{properties ? `Planos del predio ${properties.n_predio}` : '¿Qué quieres revisar?'}</h2><p className="note">Elige una actividad, adjunta el plano y explora su contenido. {properties ? 'Comprueba que el archivo corresponda a esta propiedad.' : 'Aún no hay un predio vinculado; la inspección del archivo sigue disponible.'}</p></div><button type="button" className="secondary" onClick={() => setStep('property')}>{properties ? 'Ver predio vinculado' : 'Vincular predio'}</button></div>
          <div className="inspection-result-header">
            <p>¿Quieres probar primero? Explora una vivienda ficticia, añade una mesa y compara sus dimensiones.</p>
            <button type="button" className="secondary" onClick={() => {
              inspectionController.current?.abort();
              inspectionRunId.current++;
              setInspecting(false);
              setPendingPackageEntry(null);
              setInspectionError('');
              setDrawingExample(createExampleDrawing());
              setProjectSetupOpen(false);
              requestAnimationFrame(() => document.getElementById('drawing-workspace')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }));
            }}>Ver plano de ejemplo</button>
          </div>
          <div className="project-layout">
            <section className={`project-controls${projectSetupOpen ? ' is-open' : ''}`}>
              <button type="button" className="project-intake-toggle" aria-expanded={projectSetupOpen} aria-controls="project-intake-content" onClick={() => setProjectSetupOpen(open => !open)}>
                <span className="project-intake-icon" aria-hidden="true">01</span><span><strong>Documentos y actividades</strong><small>{pdf ? pdf.name : drawingExample ? 'Vivienda ficticia · modo de ejemplo' : 'Prepara tu espacio de trabajo'}{irmPdf ? ' · IRM seleccionado' : ' · IRM pendiente'}</small></span><span className="project-intake-action">{projectSetupOpen ? 'Ocultar' : 'Editar'} <span aria-hidden="true">{projectSetupOpen ? '−' : '+'}</span></span>
              </button>
              <div id="project-intake-content" hidden={!projectSetupOpen}>
                            {/* OPTIONAL DOCUMENTS & PDF SECTION — BEGIN
                  Positioned after cadastral valuation and before appraisal.
                  Comment out this section to hide PDF analysis.
              */}
              <div className="project-setup-card">
                <div className="project-setup-grid"><div className="project-activity-fields">
                <div className="section-heading">TU PROYECTO <span>Estudio preliminar</span></div>
                <p className="note">Elige la intervención que quieres explorar. Puedes empezar con el plano y completar la documentación después.</p>

                {/* OPTIONAL WORK TYPE CONTROLS — BEGIN */}
                <label htmlFor="building-type"><strong>Tipo de inmueble</strong></label>
                <select id="building-type" value={buildingType}
                  onChange={(event) => updateDrawingActivity(workType, activities, event.target.value)}>
                  <option value="house">Casa</option>
                  <option value="apartment">Departamento</option>
                </select>

                <label htmlFor="work-type"><strong>¿Qué trabajo desea realizar?</strong></label>
                <select id="work-type" value={workType}
                  onChange={(event) => { const next = event.target.value; updateDrawingActivity(next, [WORK_ACTIVITIES[next][0][0]]); }}>
                  <option value="repair">Reparación (muro, techo, piso, etc.)</option>
                  <option value="maintenance">Pintura y mantenimiento</option>
                  <option value="remodel">Remodelación interior</option>
                  <option value="structural">Modificación estructural</option>
                  <option value="expansion">Ampliación o nueva construcción</option>
                </select>
                <fieldset className="project-activities">
                  <legend><strong>Actividades específicas (puede seleccionar varias)</strong></legend>
                  {WORK_ACTIVITIES[workType].map(([id, label]) => (
                    <label key={id}>
                      <input type="checkbox" checked={activities.includes(id)}
                        onChange={(event) => {
                          updateDrawingActivity(workType, event.target.checked ? [...activities, id] : activities.filter(value => value !== id));
                        }} />
                      {' '}{label}
                    </label>
                  ))}
                  {!activities.length && <p className="note">Seleccione al menos una actividad.</p>}
                </fieldset>
                <p className="note">
                  {irmRequired
                    ? 'Puedes visualizar esta propuesta sin IRM. Para contrastar cobertura, retiros y otros parámetros, incorpora el IRM correspondiente y revisa sus datos.'
                    : 'Puedes inspeccionar, medir y probar figuras sin IRM. La revisión urbanística se activa con la información correspondiente.'}
                  {buildingType === 'apartment'
                    ? ' En departamentos también deben revisarse elementos comunes y reglas de propiedad horizontal cuando corresponda.'
                    : ''}
                </p>
                {/* OPTIONAL WORK TYPE CONTROLS — END */}
                </div><div className="project-document-fields">

                {irmRequired && (
                <details className="irm-guide" aria-label="Documentos para el análisis">
                  <summary>Cómo obtener el IRM para revisar la propuesta</summary>
                  <p>Para el tipo de intervención seleccionado, prepare los siguientes documentos:</p>
                  <ol>
                    <li><strong>Planos arquitectónicos</strong> en PDF, DXF o DWG, individuales o reunidos en un ZIP — necesarios para analizar la geometría disponible.</li>
                    <li><strong>Informe de Regulación Metropolitana (IRM)</strong> en PDF — necesario para contrastar la propuesta con los parámetros urbanísticos. Puedes preparar el estudio del plano antes de tenerlo.</li>
                  </ol>
                  <div className="irm-quick-access">
                    <span className="irm-quick-label">Número de predio seleccionado</span>
                    <div className="irm-number-row">
                      <input aria-label="Número de predio para consulta IRM" readOnly
                        value={String(properties?.n_predio || properties?.predio || '')}
                        onFocus={event => event.target.select()} />
                      <button type="button" className="secondary" disabled={!properties} onClick={copyIrmPredio}>
                        Copiar número
                      </button>
                    </div>
                    {!properties && <p className="note">Vincula un predio para copiar su número, o consulta el portal oficial con el identificador que ya tengas.</p>}
                    <a className="irm-open-link"
                      href="https://pam.quito.gob.ec/mdmq_web_irm/irm/buscarPredio.jsf"
                      target="_blank" rel="noopener noreferrer">Abrir consulta IRM oficial ↗</a>
                    {irmCopyStatus && <p className="note" role="status">{irmCopyStatus}</p>}
                    <p className="note">El CAPTCHA se completa manualmente en el portal municipal.</p>
                  </div>
                  <details className="irm-desktop-guide">
                    <summary>Alternativa experimental: consulta IRM asistida en computadora</summary>
                    <button type="button" className="secondary" disabled={!properties || irmBridgeBusy} onClick={startIrmDesktop}>{irmBridgeBusy ? 'Conectando…' : 'Consulta asistida en escritorio'}</button>
                    <p>Si trabaja desde una computadora, puede ejecutar el prototipo local con Playwright. El programa abre Chromium, introduce el número de predio y espera a que usted complete el CAPTCHA. Después de verificar el informe, permite guardarlo como PDF.</p>
                    <p>Requiere instalar Python y Playwright en su equipo. No se ejecuta automáticamente desde esta página.</p>
                    <a href="https://github.com/jayjayanton/Predio-AI/blob/main/automation/README.md" target="_blank" rel="noopener noreferrer">Ver instrucciones de instalación y ejecución ↗</a>
                  </details>
                  <h4>¿Cómo obtener y guardar su IRM?</h4>
                  <ol>
                    <li>Pulse «Copiar número» y luego «Abrir consulta IRM oficial». Pegue el número en el campo de búsqueda del portal.</li>
                    <li>Complete manualmente el código de verificación, pulse «Consultar» y abra el informe.</li>
                    <li>Use la opción <strong>Imprimir</strong> del navegador (o del portal, si está disponible).</li>
                    <li>Seleccione <strong>Guardar como PDF</strong> en computadora. En iPhone, use <strong>Compartir → Imprimir</strong>, amplíe la vista previa y elija <strong>Compartir → Guardar en Archivos</strong>. En Android, seleccione <strong>Imprimir → Guardar como PDF</strong>.</li>
                    <li>Regrese a PredioAI y adjunte el archivo PDF en el campo IRM.</li>
                  </ol>
                  <p className="note">Si el portal no permite imprimir correctamente, pruebe desde un navegador de escritorio. PredioAI no descarga ni certifica documentos municipales automáticamente.</p>
                </details>

                )}

                <div className="document-upload">
                  <label htmlFor="blueprint-upload"><strong>1. Adjuntar plano o proyecto (PDF, DXF, DWG o ZIP) · requerido</strong></label>
                  <input key={`blueprint-${documentInputVersion}`} id="blueprint-upload" className="file-input"
                    type="file"
                    onChange={(event) => selectDocument(event, 'blueprint')}
                  />
                  {pdf && <p className="note">{isProjectPackage(pdf) ? 'Paquete seleccionado' : 'Plano seleccionado'}: {pdf.name}</p>}
                  <p className="note">PDF, DXF o DWG · máximo 15 MB. ZIP · máximo 30 MB, hasta 100 dibujos y 15 MB por dibujo. Conserva las carpetas del proyecto: podrás buscar y abrir cada archivo por su ruta.</p>
                  <details className="upload-guidance"><summary>Formatos y ayuda para cargar archivos</summary><p className="note">El DWG se convierte en el servidor para inspeccionar la geometría compatible; la vista puede ser parcial. Los PDF escaneados pueden carecer de texto y líneas seleccionables; el reconocimiento de imágenes está pendiente.</p>
                  <p className="note">En iPhone: pulsa «Elegir archivo» y luego «Explorar» para buscar el DWG o ZIP en Archivos. Si lo tienes en otra aplicación, guárdalo primero en Archivos. El selector muestra todos los archivos para evitar que iOS oculte los DWG; PredioAI valida el formato después de seleccionarlo.</p></details>
                </div>

                <div className="document-upload">
                  <label htmlFor="irm-upload"><strong>2. Adjuntar IRM oficial (PDF) · opcional para visualizar</strong></label>
                  <input key={`irm-${documentInputVersion}`} id="irm-upload" className="file-input"
                    type="file" accept="application/pdf,.pdf"
                    onChange={(event) => selectDocument(event, 'irm')}
                  />
                  {irmPdf && <p className="note">IRM seleccionado: {irmPdf.name}</p>}
                  <p className="note">Añádelo cuando tengas el IRM de esta propiedad. Sus parámetros y su relación con el plano deben revisarse.</p>
                  {irmPending && <button type="button" className="secondary" disabled={attachingIrm} onClick={attachIrmToDrawing}>{attachingIrm ? 'Leyendo IRM…' : 'Incorporar IRM al plano actual'}</button>}
                  {irmAttachNotice && <p className="note" role="status">{irmAttachNotice}</p>}
                </div>

                <p className="note document-privacy">Al inspeccionar o incorporar un IRM, el archivo se envía al servicio de análisis. Usa copias autorizadas sin datos personales innecesarios. Tu estudio se mantiene en esta sesión; exporta la huella antes de cerrar o cambiar el archivo.</p>
                <button type="button" className="primary-action"
                  disabled={!pdf || !activities.length || inspecting || attachingIrm}
                  onClick={() => inspect()}
                >
                  {inspecting ? 'Inspeccionando documentos…' : isProjectPackage(pdf) ? 'Inspeccionar mi proyecto' : 'Inspeccionar mi plano'}
                </button>
                {inspecting && <p className="note" role="status">Procesando el archivo. La primera consulta puede tardar mientras se inicia el servicio.</p>}
                {inspectionError && <p className="error" role="alert">{inspectionError}</p>}
                {!pdf && !inspectionError && <p className="note">Adjunta un plano o un paquete ZIP para continuar.</p>}
                {pdf && irmRequired && !irmPdf && <p className="note">La visualización está disponible. La revisión con parámetros del IRM queda pendiente.</p>}
                </div></div>

                {inspection && (
                  <details className="inspection document-inspection-details">
                    <summary>Información extraída de los documentos</summary>
                    <p>Actividades: {inspection.activities?.map(a => a.label).join(', ')}</p>
                    <p className="note">Cantidades de trabajo: pendientes de medición verificada.</p>
                    {inspection.blueprint.package && <p>Paquete: {inspection.blueprint.package.filename}<br />Dibujo elegido: {inspection.blueprint.package.selected_entry}</p>}
                    <p>Planos: {inspection.blueprint.format?.toUpperCase()}
                      {selectedDocumentError ? ' · no se pudo inspeccionar este dibujo' : inspection.blueprint.pages
                        ? ` · ${inspection.blueprint.pages.length} página(s)`
                        : ' · entidades CAD extraídas'}</p>
                    <p>IRM: {inspection.irm
                      ? `${inspection.irm.pages.length} página(s)`
                      : 'No adjuntado'}</p>
                    {inspection.irm && Object.keys(inspection.irm.candidate_irm_fields || {}).length > 0 && (
                      <dl>
                        {Object.entries(inspection.irm.candidate_irm_fields).map(([key, value]) => (
                          <React.Fragment key={key}>
                            <dt>{key} (sin verificar)</dt>
                            <dd>{value.raw}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    )}

                    {selectedDocumentError ? <p className="note">El paquete sigue disponible. Abre otro dibujo o vuelve a intentar la inspección del archivo elegido.</p> : <p className="note">
                      Se extrajo información preliminar de los documentos. El panel Medidas calcula
                      longitudes y áreas de contornos compatibles con la escala que confirmes.
                      La identificación automática de muros, las cantidades de obra y la
                      verificación integral de normativa siguen pendientes. La implantación permite contrastar únicamente los parámetros que revises.
                    </p>}
                  </details>
                )}
              </div>
              {/* OPTIONAL DOCUMENTS & PDF SECTION — END */}
              </div>
            </section>
            <section id="drawing-workspace" className="drawing-workspace" aria-label="Área de trabajo de planos">
              <div className="section-heading">ESPACIO DE PLANOS <span>GEOMETRÍA SIN VERIFICAR</span></div>
              {activePackage && !drawingExample && <ProjectPackagePanel manifest={activePackage}
                openedEntry={!selectedDocumentError ? inspection?.blueprint?.package?.selected_entry : null}
                pendingEntry={pendingPackageEntry} busy={inspecting}
                canOpen={Boolean(pdf && activities.length)}
                onOpen={entry => inspect(entry)} />}
              {activePackage && inspectionError && <p className="error" role="alert">{inspectionError} Puedes volver a intentarlo o abrir otro dibujo del paquete.</p>}
              {drawingExample ? <div className="inspection-result-header"><p role="status"><strong>Ejemplo interactivo · vivienda ficticia.</strong> Aplica centímetros en Medidas. Prueba una figura en la sala o selecciona «Huella de ejemplo» para preparar la implantación. «Área de ejemplo» mide 4,42 × 2,44 m. Este ejemplo no tiene predio ni IRM asociado.</p><button type="button" className="secondary" onClick={() => setDrawingExample(null)}>{inspection ? 'Volver a mi plano' : 'Cerrar ejemplo'}</button></div>
                : inspection && <div className="inspection-result-header"><p role={selectedDocumentError ? 'alert' : 'status'}><strong>{selectedDocumentError ? 'No se pudo abrir este dibujo.' : blueprintConversion?.title || 'Archivo inspeccionado.'}</strong> {selectedDocumentError || blueprintConversion?.detail || 'Revisa el dibujo y sus capas antes de abrir el resumen.'}</p><button type="button" className="secondary" onClick={() => setStep('report')}>Ver resumen documental →</button></div>}
              {displayedDrawing?.drawing_views?.length
                ? <BlueprintViewer key={`${displayedDrawing.package?.selected_entry || ''}:${displayedDrawing.filename}`} views={displayedDrawing.drawing_views} cadLayouts={displayedDrawing.cad_layouts || []} documentFormat={displayedDrawing.format} unitsCode={displayedDrawing.units_code} documentName={displayedDrawing.package?.selected_entry || displayedDrawing.filename}
                  draftState={currentPlanning.draft} onDraftStateChange={savePlanningDraft} onPlanningChange={savePlanningSnapshot}
                  setbackReview={currentSetbackReview} />
                : <div className="empty"><strong>{inspecting ? 'Abriendo el dibujo…' : selectedDocumentError ? 'Elige otro dibujo o vuelve a intentarlo.' : inspection ? 'No se encontró geometría vectorial seleccionable.' : activePackage ? 'Selecciona un dibujo del paquete.' : 'Aquí aparecerá tu plano.'}</strong><p>{inspecting ? 'La geometría y las medidas aparecerán cuando termine la inspección de este archivo.' : selectedDocumentError ? 'El listado del ZIP sigue disponible arriba. No se muestran medidas ni geometría del archivo anterior.' : inspection ? 'El archivo puede ser un escaneo o no contener trazos compatibles. Revisa el resumen y contrasta el contenido con el archivo original.' : activePackage ? 'Completa los documentos requeridos y pulsa «Abrir dibujo» para inspeccionar el archivo elegido.' : 'Adjunta un PDF, DXF, DWG o ZIP y pulsa «Inspeccionar». Podrás acercar el dibujo, seleccionar líneas y usar el panel Medidas.'}</p><p className="note">Confirma unidades o calibra una longitud conocida antes de obtener metros o m². Los resultados geométricos requieren revisión con el plano y las condiciones reales.</p></div>}
              {displayedDrawing?.drawing_views?.length > 0 && <FootprintPlanner
                snapshot={currentPlanning.snapshot} parcel={drawingExample ? null : data}
                parcelProperties={drawingExample ? null : properties} blueprint={displayedDrawing}
                irm={drawingExample ? null : inspection?.irm} apiBase={API}
                state={currentPlanning.placement} onStateChange={savePlanningPlacement}
                onSetbackReviewChange={saveSetbackReview}
                onLinkParcel={() => setStep('property')} />}
              {!drawingExample && inspection && !selectedDocumentError && <DrawingLocationPanel
                blueprint={inspection.blueprint} irm={inspection.irm}
                selectedPredio={inspection.predio_number || properties?.n_predio || properties?.predio}
                apiBase={API} reference={locationReferences}
                onReferenceChange={value => setLocationRecord({ inspection, value })}
              />}
            </section>
          </div>
        </section>
      )}
      {step === 'report' && inspection && audience === 'remodeler' && (
        <section className="report-page">
          <span className="eyebrow">PASO 2 · RESUMEN DOCUMENTAL</span>
          <h2>{properties ? `Revisión documental del predio ${properties.n_predio}` : 'Revisión de los documentos aportados'}</h2>
          {!properties && <p className="note">Sin vinculación catastral: este resumen corresponde únicamente a los archivos seleccionados.</p>}
          <p className="note">Documentos, geometría y decisiones de tu estudio reunidos en un mismo lugar. Las propuestas y comprobaciones siguen siendo preliminares.</p>
          <div className="report-grid">
            <div className="property"><h2>Documentos revisados</h2>{inspection.blueprint?.package && <p>Paquete: {inspection.blueprint.package.filename}<br />Dibujo elegido: {inspection.blueprint.package.selected_entry}</p>}<p>Plano: {inspection.blueprint?.filename || pdf?.name || 'Sin archivo'}</p><p>Formato: {inspection.blueprint?.format?.toUpperCase() || 'No disponible'}</p>{selectedDocumentError && <p className="error"><strong>No se pudo inspeccionar el dibujo.</strong> {selectedDocumentError}</p>}{blueprintConversion && <p><strong>{blueprintConversion.title}</strong> {blueprintConversion.detail}</p>}<p>IRM: {inspection.irm ? 'Adjuntado · campos candidatos sin verificar' : 'No adjuntado'}</p><p>Actividades: {inspection.activities?.map(a => a.label).join(', ') || 'No disponible'}</p></div>
            <div className="property"><h2>Estado de mediciones</h2><p>Geometría: {inspection.blueprint?.drawing_views?.length || 0} vista(s) extraída(s)</p><p>Etiquetas originales extraídas: {inspection.blueprint?.drawing_views?.reduce((total, view) => total + (view.extraction?.rendered_text_elements ?? view.source_labels?.length ?? 0), 0) || 0} (sin verificar)</p>{inspection.blueprint?.cad_layouts?.length > 0 && <p>Presentaciones CAD: {inspection.blueprint.cad_layouts.map(layout => layout.name + (layout.displayed ? ' (disponible en el visor)' : ' (sin vista extraída)')).join(' · ')}. Estas presentaciones no identifican automáticamente pisos.</p>}{inspection.blueprint?.drawing_views?.some(view => hasPartialExtraction(view.extraction)) && <p><strong>Integridad de la vista: parcial.</strong> Consulta las omisiones indicadas en el visor.</p>}<p>Unidades y escala: {reportPlanning.snapshot?.scale?.metresPerUnit ? 'confirmadas por el usuario para el estudio; sin verificación en terreno' : 'pendientes de confirmar'}</p><p>Mediciones: revisa la selección y sus unidades en el plano. Costos: no calculados.</p><p>Conformidad municipal: no evaluada</p></div>
          </div>
          {reportPlanning.snapshot && <section className="studio-report-study" aria-label="Estudio a escala">
            <div><p className="eyebrow">TU PROPUESTA</p><h3>Estudio a escala</h3><p>Conservado durante esta sesión. Vuelve al plano para editar las figuras o revisar la implantación.</p></div>
            <dl><div><dt>Escala</dt><dd>{reportPlanning.snapshot.scale?.metresPerUnit ? 'Confirmada por ti' : 'Pendiente'}</dd></div>
              <div><dt>Figuras propuestas</dt><dd>{reportPlanning.snapshot.shapes?.length || 0}</dd></div>
              <div><dt>Huella para implantación</dt><dd>{reportPlanning.snapshot.footprint ? 'Contorno seleccionado' : 'Por seleccionar'}</dd></div></dl>
            <button type="button" className="secondary" onClick={() => setStep('project')}>Continuar mi estudio →</button>
          </section>}
          {!selectedDocumentError && <DrawingLocationPanel
            blueprint={inspection.blueprint} irm={inspection.irm}
            selectedPredio={inspection.predio_number || properties?.n_predio || properties?.predio}
            apiBase={API} reference={locationReferences} compact
          />}
          <p className="source-note">Fuentes: archivos proporcionados por el usuario; la información extraída es preliminar y requiere revisión profesional.</p>
          <div className="report-actions"><button type="button" className="secondary" onClick={() => setStep('project')}>← Revisar planos</button><button type="button" className="secondary" onClick={() => setStep('property')}>{properties ? 'Ver información catastral' : 'Vincular predio (opcional)'}</button></div>
        </section>
      )}

      </>}

      {page !== 'home' && <section className="property sources-methodology" aria-label="Fuentes de datos y metodología">
        <details className="sources-methodology-details">
          <summary><span>Fuentes de datos y metodología</span><span className="sources-methodology-hint">Ver fuentes y criterios</span></summary>
          <div className="sources-methodology-body">
        <p className="note">PredioAI distingue datos oficiales consultados, documentos aportados por el usuario y cálculos orientativos. La fecha de cada capa no equivale a la fecha de consulta.</p>
        <dl>
          <dt>Catastro municipal de Quito (atributos 2024)</dt>
          <dd>Identificación, superficie registrada, frente, régimen de propiedad, uso registrado y avalúos. Fuente: <a href="https://geoquito.quito.gob.ec/server/rest/services/Hosted/predios_a_2024/FeatureServer/0" target="_blank" rel="noopener noreferrer">ArcGIS predios_a_2024 ↗</a>.</dd>
          <dt>Geometría predial (2026, cuando disponible)</dt>
          <dd>Polígono de referencia consultado en <a href="https://geoquito.quito.gob.ec/server/rest/services/Hosted/predios_2026_feb/FeatureServer/5" target="_blank" rel="noopener noreferrer">predios_2026_feb ↗</a>. Si no se encuentra una coincidencia válida, se conserva la geometría catastral original. El polígono no es la huella edificada.</dd>
          <dt>AIVA municipal (valores zonales)</dt>
          <dd>Valores referenciales de suelo por zona, no precios de mercado ni tasaciones comerciales. <a href="https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmc/valoracion_del_suelo/MapServer" target="_blank" rel="noopener noreferrer">Servicio municipal AIVA ↗</a>. La consulta por punto puede ser insuficiente en predios que atraviesan varias zonas.</dd>
          <dt>IRM oficial (archivo proporcionado por el usuario)</dt>
          <dd><a href="https://pam.quito.gob.ec/mdmq_web_irm/irm/buscarPredio.jsf" target="_blank" rel="noopener noreferrer">Consulta municipal IRM ↗</a>. Los parámetros se extraen como candidatos sin verificar; el PDF no se almacena en el servidor. El IRM no constituye permiso de construcción.</dd>
          <dt>PUGS 2024 (normativa y zonificación)</dt>
          <dd><a href="https://habitat.quito.gob.ec/geovisore" target="_blank" rel="noopener noreferrer">Geovisor oficial ↗</a> · <a href="https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/plan_de_uso_y_gestion_del_suelo_2024/MapServer/60" target="_blank" rel="noopener noreferrer">Capa de uso de suelo y edificabilidad, ID 60 ↗</a>. La consulta espacial por intersección del polígono es experimental; no determina por sí sola permisos ni superficies por zona.</dd>
          <dt>Análisis y cálculos de PredioAI</dt>
          <dd>Análisis cuantitativos y espaciales realizados a partir de información catastral, parámetros de edificabilidad, COS, superficies del predio y normativa urbanística disponible en fuentes municipales oficiales. Los resultados se calculan mediante procedimientos reproducibles y se encuentran sujetos a las condiciones y limitaciones de los datos consultados. La evaluación identifica los parámetros aplicables y las restricciones documentadas. Los retiros, afectaciones viales, cesiones, densidad, excepciones normativas y demás condiciones se incorporan cuando existe información suficiente para su análisis. Los resultados no sustituyen la verificación técnica ni la autorización de las autoridades municipales competentes.</dd>
        </dl>
        <p className="note">Cuando existan diferencias entre catastro, IRM y PUGS, prevalece la necesidad de verificar la normativa y documentación vigente ante el Municipio.</p>
          </div>
        </details>
      </section>}
      </main>
      {selectionNotice && <div className="selection-notice" role="status"><span>{selectionNotice}</span><button type="button" aria-label="Cerrar aviso" onClick={() => setSelectionNotice('')}>×</button></div>}
      {!storageAvailable && <p className="storage-note" role="status">El navegador no permite guardar la selección. Se conservará solo durante esta sesión.</p>}

      {/* FOOTER */}

      <footer className="app-footer"><span><strong>PredioAI</strong> · Planos y contexto para tu reforma.</span><span>Quito · Versión piloto · Fuentes municipales identificadas</span></footer>

    </div>
  );
}
