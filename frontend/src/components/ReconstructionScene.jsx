import React, { useEffect, useRef, useState } from 'react';
import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, DoubleSide, EdgesGeometry,
  Float32BufferAttribute, GridHelper, Group, LineBasicMaterial, Line,
  LineSegments, Mesh, MeshLambertMaterial, OrthographicCamera, Scene, Spherical,
  Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';

const PRESETS = [['3d', 'Vista 3D'], ['front', 'Frente ilustrativo'], ['side', 'Lado ilustrativo'], ['top', 'Planta']];

function disposeObjects(group) {
  group.traverse(object => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => material?.dispose());
  });
  group.clear();
}

// A real scene with a vector fallback also works on devices without WebGL2.
// Both renderers use exactly the same validated geometry and camera.
function createScene(host, onFailure) {
  let renderer;
  try {
    if (typeof window.WebGL2RenderingContext !== 'undefined') {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2', {antialias: true, alpha: false});
      if (context) renderer = new WebGLRenderer({canvas, context, antialias: true});
    }
  } catch { /* Continue with the vector renderer. */ }
  if (!renderer) renderer = new SVGRenderer();
  renderer.setPixelRatio?.(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new Color('#f3f5ef'));
  const surface = renderer.domElement;
  surface.setAttribute('aria-hidden', 'true');
  host.appendChild(surface);
  const scene = new Scene();
  const solids = new Group();
  // Imported viewer XY has Y down. The mesh builder uses Z=-Y; reflect the
  // complete model so Planta keeps the same left/right and up/down as the plan.
  solids.scale.z = -1;
  scene.add(solids);
  scene.add(new AmbientLight('#ffffff', 0.78));
  const light = new DirectionalLight('#ffffff', 0.85);
  light.position.set(-4, 9, 6); scene.add(light);
  const camera = new OrthographicCamera(-5, 5, 5, -5, 0.01, 1000);
  camera.position.set(10, 9, 12);
  const controls = new OrbitControls(camera, surface);
  controls.enableDamping = false; controls.enablePan = false;
  controls.rotateSpeed = 0.75; controls.zoomSpeed = 0.9;
  controls.minZoom = 0.2; controls.maxZoom = 8;
  controls.maxPolarAngle = Math.PI * 0.495;
  let model = null; let preset = '3d'; let disposed = false;
  const render = () => { if (!disposed && model) renderer.render(scene, camera); };
  controls.addEventListener('change', render);

  const fit = (resetZoom = true) => {
    if (!model) return;
    const box = host.getBoundingClientRect();
    const width = Math.max(1, box.width || 700); const height = Math.max(1, box.height || 420);
    renderer.setSize(width, height);
    const aspect = width / height;
    const inverse = camera.quaternion.clone().invert();
    let horizontal = 0; let vertical = 0;
    for (const x of [model.bounds.min[0], model.bounds.max[0]]) {
      for (const y of [0, model.maxHeightMetres]) {
        for (const z of [model.bounds.min[2], model.bounds.max[2]]) {
          const point = new Vector3(x, y, z).sub(controls.target).applyQuaternion(inverse);
          horizontal = Math.max(horizontal, Math.abs(point.x));
          vertical = Math.max(vertical, Math.abs(point.y));
        }
      }
    }
    const halfHeight = Math.max(vertical, horizontal / aspect, 0.1) * 1.3;
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
    camera.top = halfHeight; camera.bottom = -halfHeight;
    if (resetZoom) camera.zoom = 1;
    camera.updateProjectionMatrix(); render();
  };
  const setPreset = value => {
    preset = value;
    if (!model) return;
    const span = Math.max(model.dimensions.widthMetres, model.dimensions.depthMetres, model.maxHeightMetres, 1);
    const direction = {front: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 0], '3d': [1.2, 0.95, 1.4]}[value];
    camera.up.set(...(value === 'top' ? [0, 0, -1] : [0, 1, 0]));
    controls.target.set(0, model.maxHeightMetres / 2, 0);
    camera.position.copy(controls.target).add(new Vector3(...direction).normalize().multiplyScalar(span * 3));
    camera.far = span * 20;
    controls.enableRotate = value === '3d';
    controls.maxPolarAngle = value === '3d' ? Math.PI * 0.495 : Math.PI;
    camera.lookAt(controls.target); controls.update(); fit();
  };
  const setModel = next => {
    const first = !model; model = next;
    disposeObjects(solids);
    const colors = {base: '#b5cdbd', walls: '#e4ddcd', roof: '#ba795d'};
    for (const [name, part] of Object.entries(model.meshes)) {
      if (!part.indices.length) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(part.positions, 3));
      geometry.setIndex(part.indices); geometry.computeVertexNormals();
      const material = new MeshLambertMaterial({color: colors[name], side: DoubleSide, flatShading: true});
      solids.add(new Mesh(geometry, material));
      solids.add(new LineSegments(new EdgesGeometry(geometry, 12), new LineBasicMaterial({color: '#42605a'})));
    }
    const span = Math.max(model.dimensions.widthMetres, model.dimensions.depthMetres, 1);
    const grid = new GridHelper(span * 1.6, 16, '#c2cec3', '#e0e6df');
    grid.position.y = -Math.max(0.002, span * 0.0005); solids.add(grid);
    // SVGRenderer does not close LineLoop; explicit closure matches WebGL.
    const outlinePoints = [...model.footprintPoints, model.footprintPoints[0]];
    const outline = new BufferGeometry().setFromPoints(outlinePoints.map(([x, y]) => new Vector3(x, 0.004, -y)));
    solids.add(new Line(outline, new LineBasicMaterial({color: '#d45c1e'})));
    if (first || preset !== '3d') setPreset(preset);
    else {
      const direction = camera.position.clone().sub(controls.target).normalize();
      controls.target.set(0, model.maxHeightMetres / 2, 0);
      const fullSpan = Math.max(span, model.maxHeightMetres);
      camera.position.copy(controls.target).add(direction.multiplyScalar(fullSpan * 3));
      camera.far = fullSpan * 20;
      controls.update(); fit();
    }
  };
  const zoom = factor => {
    camera.zoom = Math.min(controls.maxZoom, Math.max(controls.minZoom, camera.zoom * factor));
    camera.updateProjectionMatrix(); controls.update(); render();
  };
  const rotate = (horizontal, vertical = 0) => {
    if (preset !== '3d') return;
    const spherical = new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    spherical.theta += horizontal;
    spherical.phi = Math.min(controls.maxPolarAngle, Math.max(0.05, spherical.phi + vertical));
    camera.position.copy(controls.target).add(new Vector3().setFromSpherical(spherical));
    camera.lookAt(controls.target); controls.update(); render();
  };
  const observer = new ResizeObserver(() => fit(false)); observer.observe(host);
  const lost = event => { event.preventDefault(); onFailure('La vista perdió el contexto gráfico. Cierra la ilustración y vuelve a abrirla.'); };
  surface.addEventListener('webglcontextlost', lost);
  return {setModel, setPreset, fit, zoom, rotate, dispose() {
    disposed = true; observer.disconnect(); controls.dispose();
    surface.removeEventListener('webglcontextlost', lost);
    disposeObjects(solids); renderer.dispose?.(); surface.remove();
  }};
}

export default function ReconstructionScene({model, assumptionLabel}) {
  const host = useRef(null); const api = useRef(null);
  const [preset, setPreset] = useState('3d');
  const [error, setError] = useState('');
  useEffect(() => {
    try { api.current = createScene(host.current, setError); }
    catch { setError('No se pudo abrir la vista ilustrativa en este dispositivo. El plano y las medidas siguen disponibles.'); }
    return () => { api.current?.dispose(); api.current = null; };
  }, []);
  useEffect(() => {
    try { api.current?.setModel(model); }
    catch { setError('No se pudo representar este volumen. El plano y las medidas siguen disponibles.'); }
  }, [model]);
  const choosePreset = value => { setPreset(value); api.current?.setPreset(value); };
  const keyboard = event => {
    if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); api.current?.zoom(event.key === '-' ? 1 / 1.2 : 1.2); }
    else if (event.key.toLowerCase() === 'f') { event.preventDefault(); api.current?.fit(); }
    else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      api.current?.rotate(event.key === 'ArrowLeft' ? -0.2 : event.key === 'ArrowRight' ? 0.2 : 0,
        event.key === 'ArrowUp' ? -0.15 : event.key === 'ArrowDown' ? 0.15 : 0);
    }
  };
  return <div className="cad-illustration-scene">
    <div className="cad-illustration-views" aria-label="Vistas de la ilustración">
      {PRESETS.map(([value, label]) => <button type="button" key={value} aria-pressed={preset === value} onClick={() => choosePreset(value)}>{label}</button>)}
    </div>
    <div className="cad-illustration-stage">
      <div ref={host} className="cad-illustration-renderer" tabIndex={0} role="group"
        aria-label={`Volumen ilustrativo interactivo. ${assumptionLabel}. Flechas para girar en vista 3D, más y menos para zoom, F para ajustar.`}
        onKeyDown={keyboard} />
      <div className="cad-illustration-watermark"><strong>ILUSTRATIVO · NO VERIFICADO</strong><span>{assumptionLabel}</span></div>
      {error && <p className="cad-illustration-render-error" role="alert">{error}</p>}
      <div className="cad-illustration-camera">
        {preset === '3d' && <><button type="button" aria-label="Girar ilustración a la izquierda" onClick={() => api.current?.rotate(-0.25)}>↶</button><button type="button" aria-label="Girar ilustración a la derecha" onClick={() => api.current?.rotate(0.25)}>↷</button></>}
        <button type="button" aria-label="Acercar ilustración" onClick={() => api.current?.zoom(1.25)}>＋</button>
        <button type="button" aria-label="Alejar ilustración" onClick={() => api.current?.zoom(0.8)}>−</button>
        <button type="button" onClick={() => api.current?.fit()}>Ajustar volumen</button>
      </div>
    </div>
    <p className="cad-illustration-help">{preset === '3d' ? 'Arrastra para girar. Rueda o dos dedos para acercar.' : 'Proyección del volumen supuesto; no es un corte constructivo del archivo.'} Las vistas conservan los mismos supuestos.</p>
  </div>;
}
