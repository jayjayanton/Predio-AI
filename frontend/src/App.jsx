const WORK_ACTIVITIES = {
  repair: [['repair_wall','Reparar muro'],['repair_floor','Reparar piso'],['repair_roof','Reparar techo'],['repair_leak','Reparar filtración']],
  maintenance: [['paint_walls','Pintar paredes'],['paint_ceiling','Pintar techo'],['waterproof','Impermeabilizar'],['renew_finishes','Renovar acabados']],
  remodel: [['replace_floor','Reemplazar piso'],['remodel_bathroom','Remodelar baño'],['remodel_kitchen','Remodelar cocina'],['change_layout','Cambiar distribución']],
  structural: [['modify_structural_wall','Modificar muro estructural'],['modify_slab','Modificar losa']],
  expansion: [['expand_room','Ampliar habitación'],['new_space','Construir nuevo espacio'],['add_floor','Añadir piso']],
};

import React, { useEffect, useState } from 'react';
import ParcelMap from './components/ParcelMap.jsx';
import BlueprintViewer from './components/BlueprintViewer.jsx';
import { inspectIrmInBrowser } from './irmBrowser.js';
import ResidentialSimulator from './ResidentialSimulator.jsx';

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
const ValuationTerm = ({label, helpKey}) => <span title={valuationHelp[helpKey]}>{label} <span aria-label="Explicación" style={{cursor:'help',textDecoration:'underline dotted',textUnderlineOffset:'3px'}}>ⓘ</span></span>;

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

  const [step, setStep] = useState('property');
  const [audience, setAudience] = useState('remodeler');
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
  const [searchHousingType,setSearchHousingType]=useState('all');
  const [searchOccupation,setSearchOccupation]=useState('all');
  const [searchParishes,setSearchParishes]=useState([]);
  const [exploreResults,setExploreResults]=useState([]);
  const [explorePugsStatus,setExplorePugsStatus]=useState('');
  const [exploreCount,setExploreCount]=useState(null);
  const [exploreBusy,setExploreBusy]=useState(false);
  const [exploreError,setExploreError]=useState('');
  const [exploreOffset,setExploreOffset]=useState(0);
  const [exploreQueryKey,setExploreQueryKey]=useState('');
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
    useState('clave_cata');

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

  // OPTIONAL APPRAISAL CONTACT DEMO — BEGIN
  // Set to false or comment out the button/modal blocks to disable.
  const [showAppraisalContact, setShowAppraisalContact] = useState(false);
  const [appraisalMessage, setAppraisalMessage] = useState('');
  // OPTIONAL APPRAISAL CONTACT DEMO — END

  // PDF inspection
  const [pdf, setPdf] = useState(null);
  const [irmPdf, setIrmPdf] = useState(null);
  // OPTIONAL WORKFLOW SELECTORS — BEGIN
  const [buildingType, setBuildingType] = useState('house');
  const [workType, setWorkType] = useState('repair');
  const [activities, setActivities] = useState(['repair_wall']);
  // IRM is needed for the preliminary expansion path; other work can
  // still require municipal/professional review depending on its scope.
  const irmRequired = ['remodel', 'structural', 'expansion'].includes(workType);
  // OPTIONAL WORKFLOW SELECTORS — END
  const [irmCopyStatus, setIrmCopyStatus] = useState('');
  const [irmBridgeBusy, setIrmBridgeBusy] = useState(false);
  const [inspection, setInspection] = useState(null);
  const [inspecting, setInspecting] = useState(false);

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
      const body = await inspectIrmInBrowser(file);
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
      setIrmExtractError(err?.message || "No se pudo procesar el PDF. Compruebe el formato e inténtelo de nuevo.");
    } finally {
      setIrmExtracting(false);
    }
  }

  // IRM files and extracted values are intentionally ephemeral.
  // Reloading the page starts with no uploaded PDF or restored IRM extraction.
  useEffect(() => {
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

  async function search(event) {
    event.preventDefault();

    setError('');
    setData(null);
    setInspection(null);
    setStep('property');

    if (!/^\d{1,25}$/.test(identifier)) {
      setError('Ingrese un identificador numérico válido.');
      return;
    }

    if (
      identifierType === 'clave_cata' &&
      identifier.length > 10
    ) {
      setError('La clave catastral no puede superar los 10 dígitos.');
      return;
    }

    setLoading(true);

    try {
      const url =
        `${API}/api/predios/` +
        `${identifierType}/` +
        `${encodeURIComponent(identifier)}`;

      const response = await fetch(url);
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.detail || 'No se pudo consultar el predio'
        );
      }

      setData(body);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Cadastral discovery: query real municipal attributes, never infer PUGS
  // classifications from cadastral land-use labels. Results are paginated.
  const CADASTRE_SEARCH='https://geoquito.quito.gob.ec/server/rest/services/Hosted/predios_a_2024/FeatureServer/0/query';
  const DMQ_PARISHES = {
    urban: [["BELISARIO QUEVEDO","Belisario Quevedo"],["CARCELEN","Carcelén"],["CENTRO HISTORICO","Centro Histórico"],["CHILIBULO","Chilibulo"],["CHILLOGALLO","Chillogallo"],["CHIMBACALLE","Chimbacalle"],["COCHAPAMBA","Cochapamba"],["COMITE DEL PUEBLO","Comité del Pueblo"],["COTOCOLLAO","Cotocollao"],["EL CONDADO","El Condado"],["GUAMANI","Guamaní"],["INAQUITO","Iñaquito"],["ITCHIMBIA","Itchimbía"],["JIPIJAPA","Jipijapa"],["KENNEDY","Kennedy"],["LA ARGELIA","La Argelia"],["LA CONCEPCION","La Concepción"],["LA ECUATORIANA","La Ecuatoriana"],["LA FERROVIARIA","La Ferroviaria"],["LA LIBERTAD","La Libertad"],["LA MAGDALENA","La Magdalena"],["LA MENA","La Mena"],["MARISCAL SUCRE","Mariscal Sucre"],["PONCEANO","Ponceano"],["PUENGASI","Puengasí"],["QUITUMBE","Quitumbe"],["RUMIPAMBA","Rumipamba"],["SAN BARTOLO","San Bartolo"],["SAN ISIDRO DEL INCA","San Isidro del Inca"],["SAN JUAN","San Juan"],["SOLANDA","Solanda"],["TURUBAMBA","Turubamba"]],
    rural: [["ALANGASI","Alangasí"],["AMAGUANA","Amaguaña"],["ATAHUALPA","Atahualpa"],["CALACALI","Calacalí"],["CALDERON","Calderón"],["CHAVEZPAMBA","Chavezpamba"],["CHECA","Checa"],["CONOCOTO","Conocoto"],["CUMBAYA","Cumbayá"],["EL QUINCHE","El Quinche"],["GUALEA","Gualea"],["GUANGOPOLO","Guangopolo"],["GUAYLLABAMBA","Guayllabamba"],["LA MERCED","La Merced"],["LLANO CHICO","Llano Chico"],["LLOA","Lloa"],["NANEGAL","Nanegal"],["NANEGALITO","Nanegalito"],["NAYON","Nayón"],["NONO","Nono"],["PACTO","Pacto"],["PERUCHO","Perucho"],["PIFO","Pifo"],["PINTAG","Píntag"],["POMASQUI","Pomasqui"],["PUELLARO","Puéllaro"],["PUEMBO","Puembo"],["SAN ANTONIO DE PICHINCHA","San Antonio de Pichincha"],["SAN JOSE DE MINAS","San José de Minas"],["TABABELA","Tababela"],["TUMBACO","Tumbaco"],["YARUQUI","Yaruquí"],["ZAMBIZA","Zámbiza"]]
  };
  const VALLEY_PARISHES=['CUMBAYA','TUMBACO','PUEMBO','PIFO','TABABELA','YARUQUI','CHECA','EL QUINCHE','GUAYLLABAMBA','NAYON','ZAMBIZA'];
  async function exploreParcels(offset=0) {
    setExploreError('');
    setExplorePugsStatus('');
    const min=Number(searchAreaMin),max=Number(searchAreaMax);
    if(!searchAreaMin||!searchAreaMax||min<=0||max<min){setExploreError('Ingrese un rango de superficie válido.');return;}
    const areaWhere='area_terre >= '+min+' AND area_terre <= '+max;
    const where=areaWhere+(searchParishes.length===0?'':' AND ('+searchParishes.map(x=>"UPPER(parroquia) = '"+x+"'").join(' OR ')+')');
    setExploreBusy(true);
    try {
      const query=async extra=>{
        const params=new URLSearchParams({f:'json',where,...extra});
        const res=await fetch(CADASTRE_SEARCH+'?'+params);
        if(!res.ok)throw new Error('HTTP '+res.status);
        const json=await res.json();
        if(json.error)throw new Error(json.error.message||'Error municipal');
        return json;
      };
      const [counts,results]=await Promise.all([
        query({returnCountOnly:'true',returnGeometry:'false'}),
        query({outFields:'n_predio,clave_cata,parroquia,area_terre,tipo_propi,zonificaci',returnGeometry:'false',orderByFields:'n_predio ASC',resultOffset:String(offset),resultRecordCount:'50'})
      ]);
      setExploreCount(Number(counts.count||0));
      const candidates=(results.features||[]).map(x=>x.attributes||{});
      const needsPugs=searchLandClass!=='all'||searchHousingType!=='all'||searchOccupation!=='all';
      if(needsPugs){
        if (API.includes('localhost') && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
          throw new Error('El filtro PUGS necesita un servidor público. La web publicada intenta conectarse a localhost:8000, que no está disponible desde este teléfono. Configure VITE_API_URL y despliegue el backend.');
        }
        const batch=candidates.filter(x=>x.n_predio!=null).slice(0,20);
        setExplorePugsStatus('Verificando hasta 20 predios de esta página contra PUGS…');
        const response=await fetch(`${API}/api/pugs/screen`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({predios:batch.map(x=>String(x.n_predio))})});
        if(!response.ok)throw new Error('El servicio PUGS no está disponible (HTTP '+response.status+').');
        const screening=await response.json();
        const byId=new Map((screening.results||[]).map(x=>[String(x.predio),x]));
        const matches=candidates.filter(candidate=>{
          const item=byId.get(String(candidate.n_predio));
          if(!item||!['single_zone','multiple_zones'].includes(item.status))return false;
          const zones=item.zones||[];
          return zones.some(z=>{
            const text=[z.leyenda,z.tipo_des,z.edifi_ba,z.edifi_gm,z.unidad_viv].filter(Boolean).join(' ').toUpperCase();
            const housing=searchHousingType==='all'||new RegExp('\\b'+searchHousingType+'\\b').test(text);
            const occupation=searchOccupation==='all'||[z.ocupa_ba,z.ocupa_gm].some(v=>String(v||'').toUpperCase().trim()===searchOccupation);
            const land=searchLandClass==='all'||String(candidate.zonificaci||'').toUpperCase().includes(searchLandClass==='urban'?'URBAN':'RURAL');
            return housing&&occupation&&land;
          });
        });
        setExploreResults(matches);
        setExplorePugsStatus(`PUGS: ${screening.screened} predios revisados de ${candidates.length} en esta página; ${matches.length} coincidencias provisionales. No es un conteo total del DMQ. Las etiquetas VU/VB/VM dependen de los atributos publicados.`);
      }else{
        setExploreResults(candidates);
        setExplorePugsStatus('');
      }
      setExploreOffset(offset);
      setExploreQueryKey([searchAreaMin,searchAreaMax,[...searchParishes].sort().join(','),searchLandClass,searchHousingType,searchOccupation].join('|'));
    }catch(e){setExploreError('No se pudo completar la búsqueda: '+e.message);setExplorePugsStatus('');setExploreResults([]);setExploreCount(null);}
    finally{setExploreBusy(false);}
  }
  async function openExplorePredio(predio) {
    if(!/^[0-9]+$/.test(String(predio)))return;
    setIdentifierType('n_predio');setIdentifier(String(predio));setError('');setLoading(true);
    try {
      const res=await fetch(`${API}/api/predios/n_predio/${encodeURIComponent(predio)}`);
      const json=await res.json();
      if(!res.ok)throw new Error(json.detail||'No se pudo cargar el predio');
      setData(json);setStep('property');
    }catch(e){setError(String(e.message));}
    finally{setLoading(false);}
  }

  // ==========================================================
  // 4. INSPECT ARCHITECTURAL PDF
  // ==========================================================

  // OPTIONAL DOCUMENT ANALYSIS V2 — BEGIN
  // One request carries selected predio, building/work type, blueprint and IRM.
  // To revert, restore the original two-document inspection handler.
  async function inspect() {
    if (!pdf || !activities.length || (irmRequired && !irmPdf)) return;
    setInspecting(true);
    setInspection(null);
    setError('');
    try {
      const form = new FormData();
      form.append('blueprint', pdf);
      if (irmRequired && irmPdf) form.append('irm', irmPdf);
      form.append('building_type', buildingType);
      form.append('work_type', workType);
      activities.forEach(activity => form.append('activities', activity));
      const predioNumber = properties?.n_predio || properties?.predio;
      if (predioNumber) form.append('predio_number', String(predioNumber));
      const response = await fetch(`${API}/api/documents/analyze`, {
        method: 'POST', body: form
      });
      const body = await response.json();
      if (!response.ok) {
        const detail = body.detail;
        throw new Error(typeof detail === 'string'
          ? detail : 'No se pudieron analizar los documentos');
      }
      setInspection(body);
      setStep('report');
    } catch (err) {
      setError(err.message);
    } finally {
      setInspecting(false);
    }
  }
  // OPTIONAL DOCUMENT ANALYSIS V2 — END

  // ==========================================================
  // 5. USER INTERFACE
  // ==========================================================

  return (
    <div className="shell">

      {/* HEADER */}

      <header className="header">

        <div className="brand">
          <span className="brand-mark">▧</span>

          <div>
            <strong>
              Predio<span>AI</span>
            </strong>
            <small>INTELIGENCIA PREDIAL</small>
          </div>
        </div>

        <div className="header-right">
          <span className="status-dot" />
          Catastro municipal de Quito
          <span className="version">MVP 0.2</span>
        </div>

      </header>

      <section className="audience-switch" aria-label="Tipo de usuario">
        <h2>¿Cómo desea utilizar PredioAI?</h2>
        <div className="audience-options">
          <button type="button" aria-pressed={audience === 'remodeler'} className={audience === 'remodeler' ? 'active' : ''}
            onClick={() => { setAudience('remodeler'); setStep('property'); setInspection(null); }}>Propietarios y remodeladores</button>
          <button type="button" aria-pressed={audience === 'developer'} className={audience === 'developer' ? 'active' : ''}
            onClick={() => { setAudience('developer'); setStep('property'); setInspection(null); }}>Nueva construcción y terrenos</button>
        </div>
        <p className="note">{audience === 'developer' ? 'Busque un terreno, consulte su IRM y explore qué tipo de vivienda podría desarrollar.' : 'Consulte su predio y revise planos para mantenimiento y remodelaciones.'}</p>
      </section>
      {audience === 'developer' && <section className="development-search-criteria" aria-label="Criterios de exploración de terrenos">
        <h2>Exploración de terrenos · Criterios de selección</h2>
        <p className="note">Defina el tipo de terreno y proyecto que desea explorar. Busque predios por superficie y parroquia, consulte el número de coincidencias y abra cualquier resultado en el mapa. Los filtros urbanísticos se verifican provisionalmente contra PUGS.</p>
        <div className="development-filter-grid">
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
          <label>Tipo de vivienda / asignación
            <select value={searchHousingType} onChange={e=>setSearchHousingType(e.target.value)}>
              <option value="all">Cualquier tipo / por verificar</option>
              <option value="VU">VU — Vivienda unifamiliar</option>
              <option value="VB">VB — Vivienda bifamiliar</option>
              <option value="VM">VM — Vivienda multifamiliar</option>
            </select>
          </label>
          <label>Forma de ocupación
            <select value={searchOccupation} onChange={e=>setSearchOccupation(e.target.value)}>
              <option value="all">Todas / por verificar</option>
              <option value="A">A — Aislada</option>
              <option value="B">B — Pareada</option>
              <option value="C">C — Continua</option>
              <option value="D">D — Sobre línea de fábrica</option>
            </select>
          </label>
        </div>
        <div className="development-filter-grid">
          <fieldset style={{border:'1px solid #607d83',borderRadius:10,padding:12,gridColumn:'1 / -1'}}>
            <legend>Parroquias / sectores ({searchParishes.length || 'todas'})</legend>
            <details><summary style={{cursor:'pointer'}}>Seleccionar múltiples parroquias</summary>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',margin:'12px 0'}}>
                <button type="button" onClick={()=>setSearchParishes([])} style={{width:'auto',minHeight:32,padding:'5px 9px',fontSize:13,flex:'0 0 auto',borderRadius:7}}>Todo el DMQ</button>
                <button type="button" onClick={()=>setSearchParishes([...new Set([...searchParishes,...VALLEY_PARISHES])])} style={{width:'auto',minHeight:32,padding:'5px 9px',fontSize:13,flex:'0 0 auto',borderRadius:7}}>Agregar valles</button>
                <button type="button" onClick={()=>setSearchParishes([...DMQ_PARISHES.urban,...DMQ_PARISHES.rural].map(x=>x[0]))} style={{width:'auto',minHeight:32,padding:'5px 9px',fontSize:13,flex:'0 0 auto',borderRadius:7}}>Seleccionar 65</button>
              </div>
              <div style={{maxHeight:240,overflowY:'auto'}}>
                {['urban','rural'].map(type=><div key={type}><strong>{type==='urban'?'Urbanas (32)':'Rurales (33)'}</strong>
                  {DMQ_PARISHES[type].map(([value,label])=><label key={value} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 2px',fontSize:14,fontWeight:400}}>
                    <input type="checkbox" style={{width:18,height:18,minWidth:18,flex:"0 0 18px",margin:0}} checked={searchParishes.includes(value)} onChange={e=>setSearchParishes(old=>e.target.checked?[...old,value]:old.filter(x=>x!==value))}/>{label}
                  </label>)}
                </div>)}
              </div>
            </details>
          </fieldset>
        </div>
        <button type="button" className="primary-action" disabled={exploreBusy} onClick={()=>exploreParcels(0)}>{exploreBusy?'Consultando catastro…':'Buscar predios que coinciden'}</button>
        {exploreError&&<p role="alert" className="error">{exploreError}</p>}
         {explorePugsStatus&&<p className="note" role="status">{explorePugsStatus}</p>}
        {exploreCount!==null&&exploreQueryKey===[searchAreaMin,searchAreaMax,[...searchParishes].sort().join(','),searchLandClass,searchHousingType,searchOccupation].join('|')&&<div className="explore-results" aria-live="polite">
          <strong>{exploreCount.toLocaleString('es-EC')} registros catastrales coincidentes (2024)</strong>
          <p className="note">Se muestran hasta 50 resultados por página. La consulta utiliza superficie registrada y parroquia; al abrir un predio se consulta su geometría 2026 cuando está disponible. Los resultados no indican terrenos en venta ni autorización de construcción.</p>
          <details open><summary>Ver predios encontrados ({exploreResults.length} en esta página)</summary>
            <div className="explore-result-list">
              {exploreResults.map((p,i)=><button type="button" className="secondary" key={String(p.n_predio)+'-'+i} onClick={()=>openExplorePredio(p.n_predio)}>
                Predio {p.n_predio} · {p.parroquia||'Sin parroquia'} · {Number(p.area_terre).toLocaleString('es-EC')} m² · Ver en mapa
              </button>)}
            </div>
          </details>
          <div style={{display:'flex',gap:10,marginTop:10}}>
            <button type="button" className="secondary" disabled={exploreBusy||exploreOffset===0} onClick={()=>exploreParcels(Math.max(0,exploreOffset-50))}>Anterior</button>
            <button type="button" className="secondary" disabled={exploreBusy||exploreOffset+50>=exploreCount} onClick={()=>exploreParcels(exploreOffset+50)}>Siguientes 50</button>
          </div>
        </div>}
        {Number(searchAreaMin)<=0||Number(searchAreaMax)<=0||searchAreaMin===''||searchAreaMax===''||Number(searchAreaMin)>Number(searchAreaMax)
          ? <p className="error" role="alert">Indique un rango de superficies válido, con mínimo menor o igual al máximo.</p>
          : <p className="note">Perfil seleccionado: {searchLandClass==='urban'?'Urbano':searchLandClass==='rural'?'Rural':'Urbano y rural'} · {Number(searchAreaMin).toLocaleString('es-EC')}–{Number(searchAreaMax).toLocaleString('es-EC')} m² · {searchHousingType==='all'?'Cualquier asignación de vivienda':searchHousingType} · Ocupación {searchOccupation==='all'?'sin restricción seleccionada':searchOccupation}. Para analizar un predio concreto, utilice la consulta catastral y su IRM.</p>}
      </section>}
      {/* MAIN LAYOUT */}

      <nav className="workflow-nav" aria-label="Etapas del proyecto">
        <button type="button" className={step === 'property' ? 'active' : ''} onClick={() => setStep('property')}>1 · Predio</button>
        <button type="button" className={step === 'project' ? 'active' : ''} disabled={!properties} onClick={() => setStep('project')}>{audience === 'developer' ? '2 · IRM y evaluación' : '2 · Proyecto y planos'}</button>
        {audience === 'remodeler' && <button type="button" className={step === 'report' ? 'active' : ''} disabled={!inspection} onClick={() => setStep('report')}>3 · Informe preliminar</button>}
      </nav>
      {step === 'property' && (      <main className="layout dashboard-layout">

        <aside className="sidebar">

          <div className="eyebrow">
            QUITO · ECUADOR
          </div>

          <h1>
            Cada predio.
            <br />
            <em>Toda su información.</em>
          </h1>

          <p className="intro">
            Consulte los límites catastrales, las superficies
            del predio y su documentación arquitectónica.
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
                setIdentifierType(event.target.value);
                setIdentifier('');
                setData(null);
                setError('');
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

          {properties && <button type="button" className="primary-action" onClick={() => setStep('project')}>{audience === 'developer' ? 'Consultar IRM y evaluar →' : 'Iniciar proyecto →'}</button>}

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
                  Clave {properties.clave_cata}
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
                <p className="note">Pase el cursor sobre ⓘ para ver qué significa cada componente. Los conceptos comunales son valores asignados a la unidad por su alícuota, no áreas privadas adicionales.</p>
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

              {/* OPTIONAL PROFESSIONAL SERVICES — BEGIN */}
              <div className="section-heading">
                SERVICIOS PROFESIONALES <span>DEMO</span>
              </div>
              <p className="note">
                ¿Necesita conocer el valor comercial del inmueble?
                Solicite una valoración profesional.
              </p>
              {/* OPTIONAL PROFESSIONAL SERVICES — END */}

              {/* OPTIONAL PROFESSIONAL APPRAISAL BUTTON — BEGIN
                  Demo only: no real professional, contact details, or submission.
                  Comment out this button to remove the entry point.
              */}
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const predio = properties?.n_predio || properties?.predio || identifier || 'XXXX';
                  setAppraisalMessage(`Hola, desearía tener una inspección formal del predio (${predio}).`);
                  setShowAppraisalContact(true);
                }}
              >
                Solicitar avalúo profesional
              </button>
              {/* OPTIONAL PROFESSIONAL APPRAISAL BUTTON — END */}

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



        </aside>

        {/* OPTIONAL PROFESSIONAL APPRAISAL CONTACT SHEET — BEGIN
            Placeholder contact only; never imply this person is verified.
            Comment out this block together with the button to disable.
        */}
        {showAppraisalContact && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="appraisal-contact-title"
            style={{
              position: 'fixed', inset: 0, zIndex: 2000,
              background: 'rgba(0,0,0,0.65)',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', padding: 20
            }}
            onClick={() => setShowAppraisalContact(false)}
          >
            <div
              className="property"
              style={{
                background: '#fff', color: '#17202a',
                borderRadius: 14, padding: 24,
                width: '100%', maxWidth: 480,
                maxHeight: '85vh', overflowY: 'auto'
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="section-heading">
                CONTACTO PARA AVALÚO <span>DEMOSTRACIÓN</span>
              </div>
              <h2 id="appraisal-contact-title">John Doe</h2>
              <p><strong>Ingeniero civil · Perito avaluador (ejemplo)</strong></p>
              <p className="note">
                Perfil ficticio para demostrar el servicio. No es un
                profesional verificado ni una oferta de avalúo real.
              </p>
              <dl>
                <dt>Especialidad</dt><dd>Avalúos comerciales de terrenos y edificaciones</dd>
                <dt>Zona de atención</dt><dd>Quito y valles (ejemplo)</dd>
                <dt>Predio de interés</dt>
                <dd>{properties?.n_predio || properties?.predio || identifier || '—'}</dd>
                <dt>Clave catastral</dt>
                <dd>{properties?.clave_cata || '—'}</dd>
                <dt>Clasificación del suelo</dt><dd>{landClassification}</dd>
                <dt>Correo electrónico (ficticio)</dt>
                <dd>john.doe.predioai.demo@gmail.com</dd>
                <dt>Teléfono Ecuador (ficticio)</dt>
                <dd>099 000 0000</dd>
                <dt>Honorarios</dt><dd>Por cotizar</dd>
              </dl>
              {/* OPTIONAL PRE-FILLED MESSAGE — BEGIN
                  Editable draft only. No messages are sent.
              */}
              <label htmlFor="appraisal-message" style={{display: 'block', marginTop: 16}}>
                <strong>Mensaje para solicitar inspección</strong>
              </label>
              <textarea
                id="appraisal-message"
                value={appraisalMessage}
                onChange={(event) => setAppraisalMessage(event.target.value)}
                rows={4}
                style={{
                  boxSizing: 'border-box', width: '100%', padding: 12,
                  marginTop: 8, marginBottom: 12, borderRadius: 8,
                  border: '1px solid #a9b0b8', font: 'inherit',
                  background: '#fff', color: '#17202a'
                }}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(appraisalMessage).catch(() => {});
                  }
                }}
              >
                Copiar mensaje
              </button>
              {/* OPTIONAL PRE-FILLED MESSAGE — END */}
              <p className="note">
                Los datos de contacto son inventados y no deben utilizarse
                para enviar solicitudes reales.
              </p>
              <p className="note">
                Próximamente: solicitud de cotización y contacto con
                profesionales habilitados. Este prototipo no envía datos.
              </p>
              <button type="button" className="secondary"
                onClick={() => setShowAppraisalContact(false)}>
                Cerrar ficha
              </button>
            </div>
          </div>
        )}
        {/* OPTIONAL PROFESSIONAL APPRAISAL CONTACT SHEET — END */}

        {/* MAP */}

        <section className="map-section">

          <div className="map-top">
            <span className="live">
              ● MAPA INTERACTIVO
            </span>

            <span>
              Mapas base de Esri · Catastro de Quito
            </span>
          </div>

          <ParcelMap data={data} />

          <div className="map-bottom">
            <span>
              Fuente: Catastro 2024 · geometría 2026 cuando disponible · AIVA zonal
            </span>

            <span>
              Límite predial ≠ huella de edificación
            </span>
          </div>

        </section>

      </main>)}
      {step === 'project' && properties && audience === 'developer' && (
        <main className="workspace-page">
          <div className="workspace-heading"><div>
            <span className="eyebrow">NUEVA CONSTRUCCIÓN · PASO 2</span>
            <h1>Potencial de construcción del predio {properties.n_predio || identifier}</h1>
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
            <h3>Datos catastrales obtenidos del API municipal</h3>
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
            <button type="button" className="secondary" disabled={irmBridgeBusy} onClick={startIrmDesktop}>{irmBridgeBusy ? 'Conectando…' : 'Consultar IRM con Playwright (escritorio)'}</button>
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
        </main>
      )}
      {step === 'project' && properties && audience === 'remodeler' && (
        <main className="workspace-page">
          <div className="workspace-heading"><div><span className="eyebrow">PASO 2 · CONFIGURACIÓN</span><h1>Proyecto para predio {properties.n_predio || identifier}</h1><p className="note">Seleccione las actividades, adjunte planos e IRM y revise los elementos gráficos extraídos.</p></div><button type="button" className="secondary" onClick={() => setStep('property')}>← Volver al predio</button></div>
          <div className="project-layout">
            <section className="project-controls">
                            {/* OPTIONAL DOCUMENTS & PDF SECTION — BEGIN
                  Positioned after cadastral valuation and before appraisal.
                  Comment out this section to hide PDF analysis.
              */}
              <div className="project-setup-card">
                <div className="section-heading">
                  REPARACIONES Y REMODELACIONES <span>EXPERIMENTAL</span>
                </div>
                <p className="note">
                  ¿Desea reparar un muro, realizar mantenimiento, remodelar
                  un espacio o ampliar su vivienda? Seleccione el tipo de
                  trabajo y adjunte los documentos disponibles.
                </p>

                {/* OPTIONAL WORK TYPE CONTROLS — BEGIN */}
                <label htmlFor="building-type"><strong>Tipo de inmueble</strong></label>
                <select id="building-type" value={buildingType}
                  onChange={(event) => { setBuildingType(event.target.value); setInspection(null); }}>
                  <option value="house">Casa</option>
                  <option value="apartment">Departamento</option>
                </select>

                <label htmlFor="work-type"><strong>¿Qué trabajo desea realizar?</strong></label>
                <select id="work-type" value={workType}
                  onChange={(event) => { const next = event.target.value; setWorkType(next); setActivities([WORK_ACTIVITIES[next][0][0]]); setInspection(null); }}>
                  <option value="repair">Reparación (muro, techo, piso, etc.)</option>
                  <option value="maintenance">Mantenimiento</option>
                  <option value="remodel">Remodelación interior</option>
                  <option value="structural">Modificación estructural</option>
                  <option value="expansion">Ampliación o nueva construcción</option>
                </select>
                <fieldset style={{ margin: '12px 0', padding: 12, border: '1px solid #b6c1cc', borderRadius: 8 }}>
                  <legend><strong>Actividades específicas (puede seleccionar varias)</strong></legend>
                  {WORK_ACTIVITIES[workType].map(([id, label]) => (
                    <label key={id} style={{ display: 'block', margin: '8px 0' }}>
                      <input type="checkbox" checked={activities.includes(id)}
                        onChange={(event) => {
                          setActivities(current => event.target.checked
                            ? [...current, id]
                            : current.filter(value => value !== id));
                          setInspection(null);
                        }} />
                      {' '}{label}
                    </label>
                  ))}
                  {!activities.length && <p className="note">Seleccione al menos una actividad.</p>}
                </fieldset>
                <p className="note">
                  {irmRequired
                    ? 'Para este tipo de proyecto, PredioAI solicita el IRM antes de realizar el análisis preliminar. Esto no sustituye la revisión de los requisitos municipales aplicables.'
                    : 'Para reparaciones y mantenimiento ordinario, PredioAI no solicita el IRM en esta etapa.'}
                  {buildingType === 'apartment'
                    ? ' En departamentos también deben revisarse elementos comunes y reglas de propiedad horizontal cuando corresponda.'
                    : ''}
                </p>
                {/* OPTIONAL WORK TYPE CONTROLS — END */}

                {irmRequired && (
                <div className="irm-guide" aria-label="Documentos para el análisis">
                  <h3>Documentos para el análisis</h3>
                  <p>Para el tipo de intervención seleccionado, prepare los siguientes documentos:</p>
                  <ol>
                    <li><strong>Planos arquitectónicos</strong> en PDF o DXF — necesarios para analizar la geometría disponible.</li>
                    <li><strong>Informe de Regulación Metropolitana (IRM)</strong> en PDF — requerido por el flujo de análisis preliminar de PredioAI para remodelaciones, modificaciones estructurales y ampliaciones.</li>
                  </ol>
                  <div className="irm-quick-access">
                    <span className="irm-quick-label">Número de predio seleccionado</span>
                    <div className="irm-number-row">
                      <input aria-label="Número de predio para consulta IRM" readOnly
                        value={String(properties?.n_predio || properties?.predio || '')}
                        onFocus={event => event.target.select()} />
                      <button type="button" className="secondary" onClick={copyIrmPredio}>
                        Copiar número
                      </button>
                    </div>
                    <button type="button" className="secondary" disabled={irmBridgeBusy} onClick={startIrmDesktop}>{irmBridgeBusy ? 'Conectando…' : 'Consultar IRM con Playwright (escritorio)'}</button>
                    <a className="irm-open-link"
                      href="https://pam.quito.gob.ec/mdmq_web_irm/irm/buscarPredio.jsf"
                      target="_blank" rel="noopener noreferrer">Abrir consulta IRM oficial ↗</a>
                    {irmCopyStatus && <p className="note" role="status">{irmCopyStatus}</p>}
                    <p className="note">Para rellenar automáticamente el predio, inicie el puente local y pulse «Consultar IRM con Playwright». Si no está instalado, use «Copiar número» y el enlace oficial. El CAPTCHA siempre se completa manualmente.</p>
                  </div>
                  <details className="irm-desktop-guide">
                    <summary>Alternativa experimental: consulta IRM asistida en computadora</summary>
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
                </div>

                )}

                <div className="document-upload">
                  <label htmlFor="blueprint-upload"><strong>1. Adjuntar planos arquitectónicos (PDF o DXF) · requerido</strong></label>
                  <input id="blueprint-upload" className="file-input"
                    type="file" accept="application/pdf,.pdf,.dxf,application/dxf"
                    onChange={(event) => { setPdf(event.target.files?.[0] || null); setInspection(null); }}
                  />
                  {pdf && <p className="note">Plano seleccionado: {pdf.name}</p>}
                  <p className="note">Los archivos DWG deben convertirse a DXF con autorización. Los planos escaneados pueden no contener geometría vectorial seleccionable.</p>
                </div>

                {irmRequired && (
                <div className="document-upload">
                  <label htmlFor="irm-upload"><strong>2. Adjuntar IRM oficial (PDF) · requerido</strong></label>
                  <input id="irm-upload" className="file-input"
                    type="file" accept="application/pdf,.pdf"
                    onChange={(event) => { setIrmPdf(event.target.files?.[0] || null); setInspection(null); }}
                  />
                  {irmPdf && <p className="note">IRM seleccionado: {irmPdf.name}</p>}
                </div>

                )}

                <button type="button" className="secondary"
                  disabled={!pdf || !activities.length || (irmRequired && !irmPdf) || inspecting}
                  onClick={inspect}
                >
                  {inspecting ? 'Inspeccionando documentos…' : 'Inspeccionar documentos'}
                </button>

                {inspection && (
                  <div className="inspection">
                    <strong>Inspección inicial de archivos</strong>
                    <p>Actividades: {inspection.activities?.map(a => a.label).join(', ')}</p>
                    <p className="note">Cantidades de trabajo: pendientes de medición verificada.</p>
                    <p>Planos: {inspection.blueprint.format?.toUpperCase()}
                      {inspection.blueprint.pages
                        ? ` · ${inspection.blueprint.pages.length} página(s)`
                        : ' · entidades CAD extraídas'}</p>
                    {irmRequired && <p>IRM: {inspection.irm
                      ? `${inspection.irm.pages.length} página(s)`
                      : 'No adjuntado'}</p>}
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

                    <p className="note">
                      Se extrajo información preliminar de los documentos. Todavía no
                      hay identificación visual de muros, cálculo de
                      superficies ni verificación de cumplimiento IRM.
                      No se generan dimensiones sin escala verificable.
                    </p>
                  </div>
                )}
              </div>
              {/* OPTIONAL DOCUMENTS & PDF SECTION — END */}


            </section>
            <section className="drawing-workspace" aria-label="Área de trabajo de planos">
              <div className="section-heading">ESPACIO DE PLANOS <span>GEOMETRÍA SIN VERIFICAR</span></div>
              {inspection?.blueprint?.drawing_views?.length
                ? <BlueprintViewer key={inspection.blueprint.filename} views={inspection.blueprint.drawing_views} />
                : <div className="empty">Adjunte un plano PDF vectorial o DXF y pulse «Inspeccionar documentos» para explorar la geometría. Los planos escaneados no permiten esta selección.</div>}
            </section>
          </div>
        </main>
      )}
      {step === 'report' && inspection && audience === 'remodeler' && (
        <main className="report-page">
          <span className="eyebrow">PASO 3 · RESULTADO PRELIMINAR</span>
          <h1>Revisión documental del predio {properties?.n_predio || identifier}</h1>
          <p className="note">Este resumen no es un informe técnico certificado, un presupuesto ni una verificación de normativa.</p>
          <div className="report-grid">
            <div className="property"><h2>Documentos revisados</h2><p>Plano: {inspection.blueprint?.filename || pdf?.name || 'Sin archivo'}</p><p>Formato: {inspection.blueprint?.format?.toUpperCase() || 'No disponible'}</p><p>IRM: {inspection.irm ? 'Adjuntado · campos candidatos sin verificar' : 'No adjuntado'}</p><p>Actividades: {inspection.activities?.map(a => a.label).join(', ') || 'No disponible'}</p></div>
            <div className="property"><h2>Estado de mediciones</h2><p>Geometría: {inspection.blueprint?.drawing_views?.length || 0} vista(s) extraída(s)</p><p>Unidades y escala: sin verificar</p><p>Áreas, longitudes y costos: no disponibles</p><p>Conformidad municipal: no evaluada</p></div>
          </div>
          <p className="source-note">Fuentes: archivos proporcionados por el usuario; la información extraída es preliminar y requiere revisión profesional.</p>
          <div className="report-actions"><button type="button" className="secondary" onClick={() => setStep('project')}>← Revisar planos</button><button type="button" className="secondary" onClick={() => setStep('property')}>Ver información catastral</button></div>
        </main>
      )}

      <section className="property" aria-label="Fuentes de datos y metodología">
        <h2>Fuentes de datos y metodología</h2>
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
      </section>

      {/* FOOTER */}

      <footer>
        PredioAI · Prototipo de investigación ·
        Se deben verificar la precisión y los permisos
        de reutilización de los datos municipales.
      </footer>

    </div>
  );
}