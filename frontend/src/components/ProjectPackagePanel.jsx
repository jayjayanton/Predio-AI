import React, { useEffect, useId, useState } from 'react';
import './ProjectPackagePanel.css';

function fileSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024)).toLocaleString('es')} KB`;
}

export default function ProjectPackagePanel({ manifest, openedEntry, pendingEntry, busy, canOpen, onOpen }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [chosenPath, setChosenPath] = useState(manifest.selected_entry || manifest.entries[0]?.path || '');

  useEffect(() => {
    setChosenPath(manifest.selected_entry || manifest.entries[0]?.path || '');
  }, [manifest.selected_entry, manifest.filename]);

  const search = query.trim().toLocaleLowerCase('es');
  const visibleEntries = manifest.entries.filter(entry => entry.path.toLocaleLowerCase('es').includes(search));
  const chosen = visibleEntries.find(entry => entry.path === chosenPath) || visibleEntries[0];
  const warnings = manifest.warnings || [];

  return (
    <section className="project-package" aria-label="Dibujos del paquete ZIP">
      <div className="project-package-heading">
        <div><p className="eyebrow">PAQUETE DE PROYECTO</p><h3>{manifest.filename}</h3></div>
        <span className="project-package-count">{manifest.entries.length} {manifest.entries.length === 1 ? 'dibujo' : 'dibujos'}</span>
      </div>
      <p className="project-package-intro">Abre cada plano, sección o alzado disponible sin volver a elegir el ZIP. Se inspecciona un archivo a la vez.</p>
      <label htmlFor={`${id}-search`}>Buscar dibujo en el ZIP</label>
      <input id={`${id}-search`} className="project-package-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre o carpeta…" />
      <label htmlFor={`${id}-drawing`}>Dibujo del paquete</label>
      <select id={`${id}-drawing`} className="project-package-files" size={Math.min(6, Math.max(3, visibleEntries.length))} value={chosen?.path || ''} disabled={!visibleEntries.length} onChange={event => setChosenPath(event.target.value)} aria-describedby={`${id}-details`}>
        {visibleEntries.map(entry => <option key={entry.path} value={entry.path}>{entry.path}</option>)}
      </select>
      <div id={`${id}-details`} className="project-package-choice" aria-live="polite">
        {chosen ? <><strong>{chosen.path}</strong><span>{chosen.format.toUpperCase()} · {fileSize(chosen.size_bytes)}{openedEntry === chosen.path ? ' · abierto en el visor' : ' · por abrir'}</span></> : <span>No se encontraron dibujos con ese nombre o carpeta.</span>}
      </div>
      <div className="project-package-actions">
        <button type="button" className="primary-action" disabled={busy || !canOpen || !chosen} onClick={() => onOpen(chosen.path)}>{busy ? 'Abriendo dibujo…' : 'Abrir dibujo'}</button>
        <p className="note" role="status">{busy ? pendingEntry ? `Abriendo: ${pendingEntry}` : 'Preparando el dibujo…' : openedEntry ? `En el visor: ${openedEntry}` : 'Elige un archivo y pulsa «Abrir dibujo».'}</p>
      </div>
      {!canOpen && <p className="note">Completa las actividades y el IRM requerido para abrir otro dibujo.</p>}
      <p className="note project-package-scope">Los nombres de archivo no confirman los pisos ni el tipo de vista. Las referencias CAD entre archivos no se ensamblan automáticamente; el ZIP no aporta alturas ni una geometría 3D que no estén en los dibujos.</p>
      {(manifest.skipped_count > 0 || warnings.length > 0) && <details className="project-package-notices"><summary>Detalles de los archivos del paquete</summary>{manifest.skipped_count > 0 && <p>{manifest.skipped_count} {manifest.skipped_count === 1 ? 'archivo no incluido' : 'archivos no incluidos'} en esta lista. Se admiten PDF, DXF y DWG; los ZIP internos no se abren.</p>}{warnings.length > 0 && <ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</details>}
    </section>
  );
}
