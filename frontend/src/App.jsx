const WORK_ACTIVITIES = {
  repair: [['repair_wall','Reparar muro'],['repair_floor','Reparar piso'],['repair_roof','Reparar techo'],['repair_leak','Reparar filtración']],
  maintenance: [['paint_walls','Pintar paredes'],['paint_ceiling','Pintar techo'],['waterproof','Impermeabilizar'],['renew_finishes','Renovar acabados']],
  remodel: [['replace_floor','Reemplazar piso'],['remodel_bathroom','Remodelar baño'],['remodel_kitchen','Remodelar cocina'],['change_layout','Cambiar distribución']],
  structural: [['modify_structural_wall','Modificar muro estructural'],['modify_slab','Modificar losa']],
  expansion: [['expand_room','Ampliar habitación'],['new_space','Construir nuevo espacio'],['add_floor','Añadir piso']],
};

import React, { useState } from 'react';
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
  // Search state
  const [identifier, setIdentifier] = useState('');
  const [identifierType, setIdentifierType] =
    useState('clave_cata');

  // Property data
  const [data, setData] = useState(null);
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
  const irmRequired = workType === 'expansion';
  const irmRecommended = workType === 'structural' || workType === 'remodel';
  // OPTIONAL WORKFLOW SELECTORS — END
  const [inspection, setInspection] = useState(null);
  const [inspecting, setInspecting] = useState(false);

  // Municipal property attributes
  const properties = data?.features?.[0]?.properties;

  // Determine whether this is Propiedad Horizontal
  const isPH =
    properties?.tipo_propi?.trim().toUpperCase() ===
    'PROPIEDAD HORIZONTAL';

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
      if (irmPdf) form.append('irm', irmPdf);
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

      {/* MAIN LAYOUT */}

      <nav className="workflow-nav" aria-label="Etapas del proyecto">
        <button type="button" className={step === 'property' ? 'active' : ''} onClick={() => setStep('property')}>1 · Predio</button>
        <button type="button" className={step === 'project' ? 'active' : ''} disabled={!properties} onClick={() => setStep('project')}>2 · Proyecto y planos</button>
        <button type="button" className={step === 'report' ? 'active' : ''} disabled={!inspection} onClick={() => setStep('report')}>3 · Informe preliminar</button>
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

          {properties && <button type="button" className="primary-action" onClick={() => setStep('project')}>Iniciar proyecto →</button>}

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
      {step === 'project' && properties && (
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
                    ? 'IRM requerido para iniciar la revisión preliminar de ampliación.'
                    : irmRecommended
                      ? 'IRM recomendado cuando existan cambios regulados; puede iniciar sin él. La revisión profesional puede ser necesaria.'
                      : 'IRM opcional para mediciones iniciales de reparación o mantenimiento.'}
                  {buildingType === 'apartment'
                    ? ' En departamentos también deben revisarse elementos comunes y reglas de propiedad horizontal cuando corresponda.'
                    : ''}
                </p>
                {/* OPTIONAL WORK TYPE CONTROLS — END */}

                <div className="irm-guide" aria-label="Documentos para el análisis">
                  <h3>Documentos para el análisis</h3>
                  <p>Prepare estos dos documentos antes de iniciar la revisión:</p>
                  <ol>
                    <li><strong>Planos arquitectónicos</strong> en PDF o DXF — necesarios para analizar la geometría disponible.</li>
                    <li><strong>Informe de Regulación Metropolitana (IRM)</strong> en PDF — obligatorio para ampliaciones y opcional para otros trabajos preliminares. Se recomienda cuando existan intervenciones sujetas a regulación.</li>
                  </ol>
                  <h4>¿Cómo obtener y guardar su IRM?</h4>
                  <ol>
                    <li>Abra el <a href="https://pam.quito.gob.ec/mdmq_web_irm/irm/buscarPredio.jsf" target="_blank" rel="noopener noreferrer">portal oficial de consulta del IRM del Municipio de Quito ↗</a>.</li>
                    <li>Busque el inmueble con su número de predio o clave catastral y abra el informe.</li>
                    <li>Use la opción <strong>Imprimir</strong> del navegador (o del portal, si está disponible).</li>
                    <li>Seleccione <strong>Guardar como PDF</strong> en computadora. En iPhone, use <strong>Compartir → Imprimir</strong>, amplíe la vista previa y elija <strong>Compartir → Guardar en Archivos</strong>. En Android, seleccione <strong>Imprimir → Guardar como PDF</strong>.</li>
                    <li>Regrese a PredioAI y adjunte el archivo PDF en el campo IRM.</li>
                  </ol>
                  <p className="note">Si el portal no permite imprimir correctamente, pruebe desde un navegador de escritorio. PredioAI no descarga ni certifica documentos municipales automáticamente.</p>
                </div>

                <div className="document-upload">
                  <label htmlFor="blueprint-upload"><strong>1. Adjuntar planos arquitectónicos (PDF o DXF) · requerido</strong></label>
                  <input id="blueprint-upload" className="file-input"
                    type="file" accept="application/pdf,.pdf,.dxf,application/dxf"
                    onChange={(event) => { setPdf(event.target.files?.[0] || null); setInspection(null); }}
                  />
                  {pdf && <p className="note">Plano seleccionado: {pdf.name}</p>}
                  <p className="note">Los archivos DWG deben convertirse a DXF con autorización. Los planos escaneados pueden no contener geometría vectorial seleccionable.</p>
                </div>

                <div className="document-upload">
                  <label htmlFor="irm-upload"><strong>2. Adjuntar IRM oficial (PDF) · {irmRequired ? 'requerido' : 'opcional'}</strong></label>
                  <input id="irm-upload" className="file-input"
                    type="file" accept="application/pdf,.pdf"
                    onChange={(event) => { setIrmPdf(event.target.files?.[0] || null); setInspection(null); }}
                  />
                  {irmPdf && <p className="note">IRM seleccionado: {irmPdf.name}</p>}
                </div>

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
      {step === 'report' && inspection && (
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

      {/* FOOTER */}

      <footer>
        PredioAI · Prototipo de investigación ·
        Se deben verificar la precisión y los permisos
        de reutilización de los datos municipales.
      </footer>

    </div>
  );
}