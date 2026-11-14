
import React, { useState } from 'react';
import ParcelMap from './components/ParcelMap.jsx';

// ============================================================
// 1. CONFIGURATION
// ============================================================

const API =
  import.meta.env.VITE_API_URL || 'http://localhost:8000';

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

  // Search state
  const [identifier, setIdentifier] = useState('');
  const [identifierType, setIdentifierType] =
    useState('clave_cata');

  // Property data
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // PDF inspection
  const [pdf, setPdf] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [inspecting, setInspecting] = useState(false);

  // Municipal property attributes
  const properties = data?.features?.[0]?.properties;

  // Determine whether this is Propiedad Horizontal
  const isPH =
    properties?.tipo_propi?.trim().toUpperCase() ===
    'PROPIEDAD HORIZONTAL';

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

  async function inspect() {
    if (!pdf) return;

    setInspecting(true);
    setInspection(null);
    setError('');

    try {
      const form = new FormData();
      form.append('file', pdf);

      const response = await fetch(
        `${API}/api/blueprints/inspect`,
        {
          method: 'POST',
          body: form
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.detail || 'No se pudo analizar el PDF'
        );
      }

      setInspection(body);

    } catch (err) {
      setError(err.message);
    } finally {
      setInspecting(false);
    }
  }

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

      <main className="layout">

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

                <dt>Zonificación</dt>
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
                    <dd>{properties._predioai_aiva_2024_usd_m2 ?? '—'}</dd>
                    <dt>2026–2027 (USD/m²)</dt>
                    <dd>{properties._predioai_aiva_2026_usd_m2 ?? '—'}</dd>
                    <dt>Variación</dt>
                    <dd>{properties._predioai_aiva_change_pct != null
                      ? `${properties._predioai_aiva_change_pct}%` : '—'}</dd>
                    <dt>Avalúo catastral total (2024)</dt>
                    <dd>{typeof properties.avaluo_tot === 'number'
                      ? `${properties.avaluo_tot.toLocaleString('en-US', {minimumFractionDigits: 2})}`
                      : '—'}</dd>
                  </dl>
                  <p className="note">
                    AIVA es un valor zonal del terreno, no un precio de
                    mercado ni el avalúo oficial total del inmueble.
                    Consulta por punto; verificar predios que cruzan varias zonas.
                  </p>
                </div>
              )}
              {/* OPTIONAL AIVA UI — END */}

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

          {/* DOCUMENTOS MUNICIPALES */}

          <div className="section-heading">
            DOCUMENTOS MUNICIPALES
            <span>PRÓXIMAMENTE</span>
          </div>

          <div className="documents">

            <div>
              ▤
              <span>Informe de Regulación Metropolitana (IRM)</span>
              <small>No conectado</small>
            </div>

            <div>
              ▤
              <span>Planos arquitectónicos aprobados</span>
              <small>Requiere autorización</small>
            </div>

          </div>

          {/* ANÁLISIS DE PLANOS */}

          <div className="section-heading">
            ANÁLISIS DE PLANOS
            <span>EXPERIMENTAL</span>
          </div>

          <p className="note">
            Suba un PDF cuyo uso tenga autorizado.
            El servidor analiza su estructura sin guardarlo
            deliberadamente. Todavía no calcula medidas.
          </p>

          <input
            className="file-input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              setPdf(
                event.target.files?.[0] || null
              );
              setInspection(null);
            }}
          />

          <button
            className="secondary"
            disabled={!pdf || inspecting}
            onClick={inspect}
          >
            {inspecting
              ? 'Analizando…'
              : 'Analizar PDF'}
          </button>

          {/* PDF RESULTS */}

          {inspection && (

            <div className="inspection">

              <strong>
                {inspection.pages} página(s)
              </strong>

              {inspection.page_info.map((page) => (
                <p key={page.page}>
                  Página {page.page}:
                  {' '}
                  {page.vector_drawings} trazados vectoriales
                  {' · '}
                  {page.text_characters} caracteres de texto
                </p>
              ))}

            </div>
          )}

        </aside>

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

      </main>

      {/* FOOTER */}

      <footer>
        PredioAI · Prototipo de investigación ·
        Se deben verificar la precisión y los permisos
        de reutilización de los datos municipales.
      </footer>

    </div>
  );
}