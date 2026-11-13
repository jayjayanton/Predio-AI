
import React, { useState } from 'react';
import ParcelMap from './components/ParcelMap.jsx';

// ============================================================
// 1. CONFIGURATION
// ============================================================

const API =
  import.meta.env.VITE_API_URL || 'http://localhost:8000';

const formatArea = (value) =>
  typeof value === 'number'
    ? `${value.toLocaleString('en-US', {
        maximumFractionDigits: 2
      })} m²`
    : 'Not available';

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
      setError('Enter a valid numeric identifier.');
      return;
    }

    if (
      identifierType === 'clave_cata' &&
      identifier.length > 10
    ) {
      setError('Cadastral key cannot exceed 10 digits.');
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
          body.detail || 'Unable to retrieve property'
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
          body.detail || 'PDF inspection failed'
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
            <small>PROPERTY INTELLIGENCE</small>
          </div>
        </div>

        <div className="header-right">
          <span className="status-dot" />
          Quito municipal GIS
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
            Every property.
            <br />
            <em>One clear view.</em>
          </h1>

          <p className="intro">
            Explore municipal parcel boundaries,
            property measurements and architectural
            documentation.
          </p>

          {/* PROPERTY SEARCH */}

          <form
            onSubmit={search}
            className="search-form"
          >

            <label htmlFor="identifierType">
              SEARCH PROPERTY BY
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
                Cadastral Key
              </option>

              <option value="n_predio">
                Predio Number
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
                    ? 'e.g. 1041102014'
                    : 'e.g. 627739'
                }
                inputMode="numeric"
              />

              <button
                type="submit"
                disabled={loading}
              >
                {loading
                  ? 'Searching…'
                  : 'Find parcel'}
              </button>

            </div>
          </form>

          {/* ERROR MESSAGE */}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {/* PROPERTY RECORD */}

          <div className="section-heading">
            PROPERTY RECORD
            <span>
              {properties
                ? 'FOUND'
                : 'AWAITING SEARCH'}
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
                  Property type: Propiedad Horizontal
                  (PH). This property shares a global
                  cadastral lot with other units.
                </p>
              )}

              {/* PRIMARY MEASUREMENTS */}

              <div className="stats">

                <div>
                  <small>
                    {isPH
                      ? 'ATTRIBUTED LAND AREA'
                      : 'LAND AREA'}
                  </small>

                  <strong>
                    {formatArea(displayedLandArea)}
                  </strong>
                </div>

                <div>
                  <small>
                    TOTAL CONSTRUCTION
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

                <dt>Predio number</dt>
                <dd>
                  {properties.n_predio || '—'}
                </dd>

                <dt>Property type</dt>
                <dd>
                  {properties.tipo_propi || '—'}
                </dd>

                <dt>Zoning</dt>
                <dd>
                  {properties.zonificaci || '—'}
                </dd>

                <dt>Building use</dt>
                <dd>
                  {properties.uso_constr || '—'}
                </dd>

              </dl>

              {/* HORIZONTAL PROPERTY DETAILS */}

              {isPH && (

                <div className="ph-details">

                  <div className="section-heading">
                    HORIZONTAL PROPERTY
                    <span>PH</span>
                  </div>

                  <dl>

                    <dt>Global lot area</dt>
                    <dd>
                      {formatArea(
                        properties.area_terre
                      )}
                    </dd>

                    <dt>Attributed land area</dt>
                    <dd>
                      {formatArea(
                        properties.area_ter_1
                      )}
                    </dd>

                    <dt>Ownership share</dt>
                    <dd>
                      {typeof properties.alicuota_p ===
                      'number'
                        ? `${properties.alicuota_p.toFixed(2)}%`
                        : 'Not available'}
                    </dd>

                    <dt>Total construction</dt>
                    <dd>
                      {formatArea(
                        properties.area_const
                      )}
                    </dd>

                  </dl>

                  <p className="note">
                    The highlighted polygon represents
                    the associated global cadastral lot,
                    not the individual house footprint.
                    Attributed land area represents a
                    cadastral allocation rather than a
                    surveyed private lot.
                  </p>

                </div>
              )}

              {/* MULTIPLE MATCHES */}

              {data.features.length > 1 && (
                <p className="note">
                  {data.features.length} matching
                  records. Displaying the first
                  record's attributes and all returned
                  polygons.
                </p>
              )}

            </div>

          ) : (

            <div className="empty">
              Search by cadastral key or predio number
              to retrieve municipal property records
              and locate the associated cadastral lot.
            </div>

          )}

          {/* MUNICIPAL DOCUMENTS */}

          <div className="section-heading">
            MUNICIPAL DOCUMENTS
            <span>COMING SOON</span>
          </div>

          <div className="documents">

            <div>
              ▤
              <span>Regulation report (IRM)</span>
              <small>Not connected</small>
            </div>

            <div>
              ▤
              <span>Approved architectural plans</span>
              <small>Authorization required</small>
            </div>

          </div>

          {/* BLUEPRINT INSPECTION */}

          <div className="section-heading">
            BLUEPRINT INSPECTION
            <span>EXPERIMENTAL</span>
          </div>

          <p className="note">
            Upload a PDF you are authorized to use.
            The server inspects page structure without
            deliberately storing the file.
            No measurements are inferred yet.
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
              ? 'Inspecting…'
              : 'Inspect PDF'}
          </button>

          {/* PDF RESULTS */}

          {inspection && (

            <div className="inspection">

              <strong>
                {inspection.pages} page(s)
              </strong>

              {inspection.page_info.map((page) => (
                <p key={page.page}>
                  Page {page.page}:
                  {' '}
                  {page.vector_drawings} vector paths
                  {' · '}
                  {page.text_characters} text characters
                </p>
              ))}

            </div>
          )}

        </aside>

        {/* MAP */}

        <section className="map-section">

          <div className="map-top">
            <span className="live">
              ● LIVE MAP
            </span>

            <span>
              Esri basemaps · Quito cadastral data
            </span>
          </div>

          <ParcelMap data={data} />

          <div className="map-bottom">
            <span>
              Municipal source: predios_a_2024
            </span>

            <span>
              Parcel boundary ≠ building footprint
            </span>
          </div>

        </section>

      </main>

      {/* FOOTER */}

      <footer>
        PredioAI · Research prototype ·
        Municipal data accuracy and reuse permissions
        require verification.
      </footer>

    </div>
  );
}