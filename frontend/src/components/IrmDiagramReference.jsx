import React, {useEffect, useState} from 'react';

// A filename is not an identity: two inspected files can share the same name.
const diagrams = new WeakMap();
function readDiagram(file) {
  if (!diagrams.has(file)) {
    const task = import('../irmBrowser.js').then(module => module.inspectIrmDiagramInBrowser(file))
      .catch(error => {diagrams.delete(file); throw error;});
    diagrams.set(file, task);
  }
  return diagrams.get(file);
}

/** The caller supplies only the exact File associated with the current inspected IRM. */
export default function IrmDiagramReference({file}) {
  const [openFile, setOpenFile] = useState(null);
  const [record, setRecord] = useState(null);
  const [source, setSource] = useState(null);
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setSource({file, url});
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!file || openFile !== file) return undefined;
    let active = true;
    setRecord({file, status: 'loading'});
    readDiagram(file).then(diagram => {
      if (active) setRecord({file, status: 'ready', diagram});
    }, error => {
      if (active) setRecord({file, status: 'error', message: error.message || 'No se pudo mostrar el esquema.'});
    });
    return () => {active = false;};
  }, [file, openFile]);
  if (!file) return null;
  const current = record?.file === file ? record : null;
  const diagram = current?.diagram;
  const url = source?.file === file ? source.url : null;
  return <details className="footprint-irm-diagram" open={openFile === file} onToggle={event => setOpenFile(event.currentTarget.open ? file : null)}>
    <summary>Consultar esquema del IRM</summary>
    {openFile === file && <div>
      {current?.status === 'loading' && <p role="status">Buscando el esquema en tu IRM…</p>}
      {diagram?.image && <figure><img src={diagram.image} alt={`Esquema de implantación del IRM ${file.name}${diagram.imagePage ? `, página ${diagram.imagePage}` : ''}`}/>
        <figcaption>{diagram.imagePage ? `Página ${diagram.imagePage}. ` : ''}Imagen de referencia. El límite del mapa se calcula sobre el predio con las distancias de retiro que revises.</figcaption></figure>}
      {current?.status === 'ready' && !diagram?.image && <p>No se identificó un esquema de implantación en este PDF. Consulta el archivo original.</p>}
      {current?.status === 'error' && <p role="status">{current.message} Puedes consultar el PDF original.</p>}
      {url && <a className="footprint-irm-source-link" href={`${url}${diagram?.imagePage ? `#page=${diagram.imagePage}` : ''}`} target="_blank" rel="noreferrer">Abrir IRM original · {file.name}</a>}
    </div>}
  </details>;
}
