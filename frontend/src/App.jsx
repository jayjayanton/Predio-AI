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

// ============================================================
// 1. CONFIGURATION
// ============================================================

const API =
  import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Optional valuation display helpers. Values remain cadastral, not market prices.
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
  const pugsUse = dominantZone?.tipo_des || dominantZone?.leyenda || dominantZone?.uso_prin || null;
  const pugsDescription = zone => {
    const raw = String(zone?.tipo_des || zone?.leyenda || zone?.uso_prin || 'Clasificación no disponible');
    return raw.replace(/\s*(?:tipo\s*\d+|[-–]\s*\d+)\s*$/i, '').trim();
  };
  const dominantOverlap = Number(dominantZone?._overlap_percent);
  const hasMeasuredOverlap = dominantZone?._overlap_percent != null && Number.isFinite(dominantOverlap);
  const singleZoningClassification = pugsZones.length === 1 || (hasMeasuredOverlap && dominantOverlap > 90);
  const zoningClassifications = singleZoningClassification && dominantZone ? [dominantZone] : pugsZones;

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
  const [inspection, setInspection] = useState(null);
  const [inspecting, setInspecting] = useState(false);

  // Copy the known predio number and open the official portal on a user click.
  // Browsers cannot prefill a separate site's form; CAPTCHA stays manual.
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
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${API}/api/irm/extract`, { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'No se pudo leer el IRM');
      const fields = body.candidate_irm_fields || {};
      const parsed = key => fields[key]?.raw?.replace(',', '.') || '';
      const selectedPredio = String(properties?.n_predio || '').trim();
      const extractedPredio = parsed('predio');
      if (selectedPredio && extractedPredio && selectedPredio !== extractedPredio) {
        throw new Error('El número de predio del IRM no coincide con el predio seleccionado. Revise el documento.');
      }
      setIrmExtraction(body);
      setIrmValues({ area: parsed('area_terreno') || cadastralAreaValue, cosPb: parsed('cos_pb'), cosTotal: parsed('cos_total'), floors: parsed('pisos'), minLot: parsed('lote_minimo'), minFront: parsed('frente_minimo'), dwellingCode: parsed('vivienda_tipo') });
      setDeveloperAreaSource(fields.area_terreno ? 'Fuente: IRM aportado (extracción automática, sin verificar).' : cadastralAreaValue ? `Fuente: Catastro municipal (${cadastralAreaLabel}); el IRM no contenía un área reconocible.` : 'Área del predio no disponible en las fuentes. No se utiliza el lote matriz como sustituto.');
    } catch (err) {
      setIrmExtractError(err.message);
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
                <dl>
                  <dt>Avalúo del terreno</dt>
                  <dd>{formatUSD(properties.avaluo_ter)}</dd>
                  <dt>Avalúo de construcción</dt>
                  <dd>{formatUSD(properties.avaluo_con)}</dd>
                  <dt>Otros componentes del avalúo</dt>
                  <dd>{typeof properties.avaluo_tot === 'number' &&
                    typeof properties.avaluo_ter === 'number' &&
                    typeof properties.avaluo_con === 'number'
                    ? formatUSD(properties.avaluo_tot - properties.avaluo_ter - properties.avaluo_con)
                    : 'No disponible'}</dd>
                  <dt>Avalúo total</dt>
                  <dd><strong>{formatUSD(properties.avaluo_tot)}</strong></dd>
                  <dt>Avalúo terreno por m² atribuido</dt>
                  <dd>{typeof properties.avaluo_ter === 'number' &&
                    typeof displayedLandArea === 'number' && displayedLandArea > 0
                    ? formatRate(properties.avaluo_ter / displayedLandArea)
                    : 'No disponible'}</dd>
                  <dt>Avalúo construcción por m²</dt>
                  <dd>{typeof properties.avaluo_con === 'number' &&
                    typeof properties.area_const === 'number' && properties.area_const > 0
                    ? formatRate(properties.avaluo_con / properties.area_const)
                    : 'No disponible'}</dd>
                </dl>
                <p className="note">Fuente: avalúo catastral municipal 2024.</p>
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
            <a className="irm-open-link" href="https://pam.quito.gob.ec/mdmq_web_irm/irm/buscarPredio.jsf" target="_blank" rel="noopener noreferrer">Abrir consulta IRM oficial ↗</a>
            <p className="note">Complete el CAPTCHA manualmente. La automatización Playwright local no está integrada a la web.</p>
            <details><summary>Consulta asistida desde computadora</summary>
              <p>El prototipo local puede abrir el portal y esperar la verificación manual.</p>
              <a href="https://github.com/jayjayanton/Predio-AI/blob/main/automation/README.md" target="_blank" rel="noopener noreferrer">Instrucciones de Playwright ↗</a>
            </details>
            <label htmlFor="developer-irm-upload"><strong>Adjuntar IRM obtenido (PDF)</strong></label>
            <input id="developer-irm-upload" type="file" accept=".pdf,application/pdf" onChange={event => uploadDeveloperIrm(event.target.files?.[0] || null)} />
            {irmExtracting && <p role="status">Extrayendo parámetros del IRM…</p>}
            {irmExtractError && <p role="alert" className="error">{irmExtractError}</p>}
            {developerIrm && <p role="status">Archivo seleccionado: {developerIrm.name}</p>}
            {irmExtraction && <details className="inspection irm-document-details">
              <summary><strong>Detalles del IRM cargado</strong> · {irmExtraction.filename || developerIrm?.name || 'Documento procesado'} · {irmExtraction.pages} página(s)</summary>
              <p className="note">Campos extraídos automáticamente (sin verificar). El archivo PDF no se almacena en el servidor.</p>
              <dl>{Object.entries(irmExtraction.candidate_irm_fields || {}).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{value.raw}</dd></React.Fragment>)}</dl>
              {!Object.keys(irmExtraction.candidate_irm_fields || {}).length && <p>No se encontraron parámetros reconocibles. Verifique si el PDF está escaneado.</p>}
              {irmExtraction.warnings?.map(w => <p className="note" key={w}>{w}</p>)}
            </details>}
          <p className="note">El IRM se contrasta con la zonificación PUGS para contextualizar qué tipos de construcción pueden permitirse en el área. La compatibilidad normativa y la factibilidad del predio se evalúan por separado.</p>
          </section>
          <section className="property">
            <h2>Compatibilidad del proyecto</h2>
            <label htmlFor="development-type"><strong>¿Qué desea construir?</strong></label>
            <select id="development-type" value={developmentType} onChange={e => setDevelopmentType(e.target.value)}>
              <option value="single">Una vivienda</option>
              <option value="multiple">Varias viviendas / conjunto</option>
              <option value="subdivision">Subdivisión de terreno</option>
              <option value="apartments">Edificio multifamiliar</option>
            </select>

            {!irmExtraction ? <p className="note">Adjunte el IRM para activar el análisis de compatibilidad con el contexto PUGS.</p> : <div className="compatibility-overview">
              <p className="compatibility-status"><strong>{projectCompatibility}</strong></p>
              <p className="note">{singleZoningClassification ? 'Zonificación del polígono catastral:' : 'Zonificaciones intersectadas:'} <strong>{zoningClassifications.length ? zoningClassifications.map(pugsDescription).join(' / ') : 'No determinada'}</strong>.</p>
              {pugsZones.length > 1 && <div className="zoning-intersections">
                <strong>Zonas PUGS intersectadas ({pugsZones.length})</strong>
                <ul>{pugsZones.map((zone, i) => <li key={zone.OBJECTID || i}>
                  <strong>{zone.tipo_des || zone.leyenda || zone.uso_prin || `Zona ${i + 1}`}</strong>
                  {zone._overlap_percent != null && <span> — {zone._overlap_percent}% del polígono</span>}
                </li>)}</ul>
              </div>}
              {pugsZones.length > 1 && <p className="note">La zona predominante no reemplaza las otras zonas intersectadas; la norma aplicable depende de la ubicación exacta del proyecto.</p>}
              <div className="capacity-inputs">
                {[
                  ['single', 'Casa / vivienda individual'],
                  ['multiple', 'Varias viviendas / conjunto'],
                  ['apartments', 'Edificio de departamentos']
                ].map(([type, label]) => <div key={type}><strong>{label}</strong><p>{permissionLabels[projectPermission(type)] || 'Uso no verificado'}</p></div>)}
              </div>
              <p className="note">El cruce espacial describe la zona, pero no constituye por sí solo una autorización ni una prohibición. Los resultados definitivos requieren reglas oficiales de usos permitidos y el IRM correspondiente.</p>
              {isCadastralPH && <p className="note">El cruce espacial corresponde al lote matriz de la propiedad horizontal, no a los derechos individuales de esta unidad.</p>}
            </div>}
            <p className="source-note">Fuentes: catastro municipal, IRM cargado y PUGS 2024 (unión espacial de polígonos).</p>
          </section>
          <section className="property">
            <h2>Factibilidad del predio</h2>
            {!irmExtraction ? <p className="note">Cargue el IRM para revisar las condiciones del predio y calcular su potencial constructivo.</p> : <>
              <p><strong>{parcelFeasibility}</strong></p>
              {zoningClassifications.length > 0 && <div className="zoning-classification">
                <strong>{singleZoningClassification ? 'Clasificación PUGS:' : 'Clasificaciones PUGS:'}</strong>
                {zoningClassifications.map((zone, i) => <p key={zone.OBJECTID || i}>
                  {pugsDescription(zone)}{!singleZoningClassification && zone._overlap_percent != null ? ` — ${zone._overlap_percent}% del polígono` : ''}
                </p>)}
                {!singleZoningClassification && <p className="note">Ninguna zona supera el 90% de cobertura verificada; se muestran todas las zonas intersectadas.</p>}
              </div>}
              {developerAreaSource && <p className="note">{developerAreaSource}</p>}
              <div className="capacity-inputs">
                <div><strong>Área del predio</strong><p>{irmValues.area ? formatArea(Number(irmValues.area)) : 'No extraída'}</p></div>
                <div><strong>Lote mínimo (IRM)</strong><p>{irmValues.minLot ? formatArea(Number(irmValues.minLot)) : 'No extraído'}</p></div>
                <div><strong>Frente mínimo (IRM)</strong><p>{irmValues.minFront ? `${irmValues.minFront} m` : 'No extraído'}</p></div>
                <div><strong>COS PB / total</strong><p>{irmValues.cosPb !== '' ? `${irmValues.cosPb}%` : '—'} / {irmValues.cosTotal !== '' ? `${irmValues.cosTotal}%` : '—'}</p></div>
                <div><strong>Pisos (IRM)</strong><p>{irmValues.floors || 'No extraído'}</p></div>
                {!isCadastralPH && Number(irmValues.area) > 0 && Number(irmValues.minLot) > 0 && <div><strong>Máximo teórico de lotes por área</strong><p>{Math.floor(Number(irmValues.area) / Number(irmValues.minLot))} (sin descontar vías ni cesiones)</p></div>}
              </div>
              {isCadastralPH && <p className="note">Propiedad horizontal: el área del lote matriz no representa derechos constructivos independientes de esta unidad.</p>}
              <p className="note">Parámetros extraídos del IRM, pendientes de comprobación. La capacidad es teórica y no constituye autorización municipal.</p>
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
              <p className="note">{developmentType === 'apartments' ? 'Para un edificio multifamiliar debe verificarse expresamente la compatibilidad de uso, densidad y normativa aplicable; los pisos y el COS no bastan.' : developmentType === 'single' ? 'Para vivienda individual deben verificarse retiros, uso permitido y condiciones del lote.' : 'Para múltiples viviendas o subdivisión se requieren además frente, lote mínimo, accesos, cesiones y permisos correspondientes.'}</p>
              <p className="note">Compatibilidad de uso residencial: pendiente de validación. No es posible afirmar que se permitan o prohíban apartamentos únicamente con COS y pisos.</p>
              <p className="note">Estos límites no establecen cuántas viviendas pueden aprobarse ni su tamaño individual. Faltan uso de suelo, densidad, retiros, frente, afectaciones, acceso y otras condiciones.</p>
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
                    <a className="irm-open-link"
                      href="https://pam.quito.gob.ec/mdmq_web_irm/irm/buscarPredio.jsf"
                      target="_blank" rel="noopener noreferrer">Abrir consulta IRM oficial ↗</a>
                    {irmCopyStatus && <p className="note" role="status">{irmCopyStatus}</p>}
                    <p className="note">El portal municipal no permite precargar el número mediante este enlace. Pulse «Copiar número», abra la consulta y péguelo en el campo de búsqueda. El código de verificación se completa manualmente.</p>
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
          <dt>Cálculos propios de PredioAI</dt>
          <dd>Estimaciones teóricas basadas en área, COS y lote mínimo; no incluyen automáticamente retiros, vías, cesiones, densidad, excepciones normativas ni autorización municipal.</dd>
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