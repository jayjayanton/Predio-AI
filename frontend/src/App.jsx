import { useState } from 'react';
import ParcelMap from './components/ParcelMap.jsx';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const formatArea = value => typeof value === 'number' ? `${value.toLocaleString('en-US', {maximumFractionDigits: 2})} m²` : 'Not available';

export default function App() {
  const [number, setNumber] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdf, setPdf] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [inspecting, setInspecting] = useState(false);
  const properties = data?.features?.[0]?.properties;

  async function search(event) {
    event.preventDefault();
    setError(''); setData(null);
    if (!/^\d{1,25}$/.test(number)) { setError('Enter a valid numeric predio identifier.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/predios/${encodeURIComponent(number)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || 'Unable to retrieve parcel');
      setData(body);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  async function inspect() {
    if (!pdf) return;
    setInspecting(true); setInspection(null); setError('');
    try {
      const form = new FormData(); form.append('file', pdf);
      const res = await fetch(`${API}/api/blueprints/inspect`, {method: 'POST', body: form});
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || 'PDF inspection failed');
      setInspection(body);
    } catch (err) { setError(err.message); }
    finally { setInspecting(false); }
  }
  return <div className="shell">
    <header className="header"><div className="brand"><span className="brand-mark">▧</span><div><strong>Predio<span>AI</span></strong><small>PROPERTY INTELLIGENCE</small></div></div><div className="header-right"><span className="status-dot"/> Quito municipal GIS <span className="version">MVP 0.1</span></div></header>
    <main className="layout">
      <aside className="sidebar">
        <div className="eyebrow">QUITO · ECUADOR</div>
        <h1>Every property.<br/><em>One clear view.</em></h1>
        <p className="intro">Explore municipal parcel boundaries and prepare architectural documentation for intelligent measurements.</p>
        <form onSubmit={search} className="search-form"><label htmlFor="predio">MUNICIPAL PREDIO NUMBER</label><div className="search-row"><input id="predio" value={number} onChange={e=>setNumber(e.target.value)} placeholder="e.g. 1" inputMode="numeric"/><button disabled={loading}>{loading ? 'Searching…' : 'Find parcel'}</button></div></form>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="section-heading">PROPERTY RECORD <span>{properties ? 'FOUND' : 'AWAITING SEARCH'}</span></div>
        {properties ? <div className="property"><div className="property-title"><strong>Predio {properties.n_predio}</strong><span>{properties.parroquia || 'Quito'}</span></div><div className="stats"><div><small>LAND AREA</small><strong>{formatArea(properties.area_terre)}</strong></div><div><small>BUILT AREA</small><strong>{formatArea(properties.area_const)}</strong></div></div><dl><dt>Cadastral key</dt><dd>{properties.clave_cata || '—'}</dd><dt>Zoning</dt><dd>{properties.zonificaci || '—'}</dd><dt>Building use</dt><dd>{properties.uso_constr || '—'}</dd></dl>{data.features.length>1 && <p className="note">{data.features.length} matching records; displaying the first record's attributes and all returned polygons.</p>}</div> : <div className="empty">Search a predio to retrieve official parcel attributes and zoom to its location.</div>}
        <div className="section-heading">MUNICIPAL DOCUMENTS <span>COMING SOON</span></div><div className="documents"><div>▤ <span>Regulation report (IRM)</span><small>Not connected</small></div><div>▤ <span>Approved architectural plans</span><small>Authorization required</small></div></div>
        <div className="section-heading">BLUEPRINT INSPECTION <span>EXPERIMENTAL</span></div><p className="note">Upload a PDF you are authorized to use. The server inspects page structure without storing the file. No measurements are inferred yet.</p><input className="file-input" type="file" accept="application/pdf,.pdf" onChange={e=>{setPdf(e.target.files?.[0]||null);setInspection(null)}}/><button className="secondary" disabled={!pdf||inspecting} onClick={inspect}>{inspecting?'Inspecting…':'Inspect PDF'}</button>{inspection && <div className="inspection"><strong>{inspection.pages} page(s)</strong>{inspection.page_info.map(p=><p key={p.page}>Page {p.page}: {p.vector_drawings} vector paths · {p.text_characters} text characters</p>)}</div>}
      </aside>
      <section className="map-section"><div className="map-top"><span className="live">● LIVE MAP</span><span>OpenStreetMap · Quito cadastral data</span></div>
        <div
          style={{
            height: "100%",
            minHeight: "600px",
            background: "#dce8e5",
            color: "#173a37",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontSize: "24px",
            fontWeight: "bold"
          }}
        >
          PredioAI Map Placeholder
        </div>
      <div className="map-bottom">
        <span>Municipal source: predios_a_2024</span>
        <span>Parcel boundary ≠ building footprint</span>
        </div>
        </section>
    </main><footer>PredioAI · Research prototype · Municipal data accuracy and reuse permissions require verification.</footer>
  </div>;
}
