# Consulta IRM asistida — prototipo de escritorio

Este módulo es **opcional** y funciona **localmente en Windows/macOS/Linux**. No se ejecuta automáticamente desde GitHub Pages ni desde Render. El usuario debe iniciar el script en su propio computador; el navegador Chromium que se abre pertenece a esa sesión local.

## Instalar (PowerShell, desde la raíz del repositorio)

```powershell
py -m pip install -r automation/requirements.txt
py -m playwright install chromium
```

## Integración con PredioAI (puente local experimental)

1. Instale las dependencias indicadas arriba y descargue/actualice el repositorio en su PC.
2. En PowerShell, desde la raíz del repositorio, ejecute:

```powershell
py automation/irm_bridge.py
```

3. Mantenga abierta esa ventana de PowerShell. Abra **https://jayjayanton.github.io/Predio-AI/** en Chrome o Edge, busque el predio y pulse **«Consultar IRM con Playwright (escritorio)»**.
4. El navegador Chromium de Playwright se abrirá con el número del predio rellenado. Complete el CAPTCHA **manualmente**, pulse CONSULTAR y espere a que el script valide el informe y genere `~/Downloads/IRM_<predio>.pdf`.
5. Revise el PDF y adjúntelo a PredioAI. **La importación automática del PDF no está implementada.**

El puente escucha **solo** en `127.0.0.1:8765`, valida el origen de la solicitud, acepta únicamente números de predio y rechaza una segunda sesión mientras otra está en marcha. No necesita exponer puertos a Internet ni ejecutar el servicio en Render. No automatiza CAPTCHA. **Chrome/Edge pueden bloquear solicitudes desde una página HTTPS pública a un servicio HTTP local** por controles de acceso a red local; si aparece un error de conexión, revise los permisos del navegador o utilice el método manual descrito abajo. La compatibilidad con navegadores reales debe probarse en el equipo del usuario.

**Reversión inmediata:** no ejecute el puente y use los botones existentes «Copiar número» + «Abrir consulta IRM oficial». La función original no se elimina.

## Ejecutar con el predio real

En PredioAI, consulte un predio y anote su **número de predio** (no la clave catastral). Luego:

```powershell
py automation/irm_playwright.py 627739
```

Sustituya `627739` por el número real seleccionado en PredioAI. Este método manual no requiere el puente local. Para enviar el número automáticamente desde PredioAI, siga la sección «Integración con PredioAI» anterior.

1. Abre el portal oficial `buscarPredio.jsf` en Chromium visible.
2. Rellena el número de predio indicado.
3. **El usuario resuelve el CAPTCHA y pulsa CONSULTAR**. No se automatiza ni evade el CAPTCHA.
4. Espera hasta cinco minutos para detectar `/irm/irm.jsf` en la sesión del navegador (misma pestaña o pestaña nueva).
5. Verifica automáticamente que la página contiene la sección **Datos del Predio** y el número solicitado. Si falla, no exporta el archivo.
6. Genera `~/Downloads/IRM_<predio>.pdf` mediante impresión Chromium.
7. El usuario verifica que el PDF contenga todas las páginas y luego lo adjunta manualmente en **PredioAI → Proyecto y planos → IRM**.

**Destino de descarga:** por defecto se guarda en la carpeta **Descargas / Downloads** del usuario del sistema operativo, fuera del repositorio. Puede cambiarse con `--output-dir` cuando ejecute `irm_playwright.py` directamente. Los informes son archivos locales y no se suben a GitHub.

**Limitaciones:** La detección de URL y las comprobaciones automáticas no garantizan que el informe esté completo; la salida de Chromium puede diferir de la opción de impresión oficial del Municipio. No se ha validado la exportación de un informe real. No suba informes sensibles a un sitio público sin revisar su tratamiento. El script no está conectado al backend Render ni al frontend GitHub Pages. Si el portal cambia de estructura, habrá que actualizar selectores y detección.

## Arquitectura prevista

`PredioAI (consulta catastral) → número de predio → ejecución local de Playwright → CAPTCHA manual → página IRM detectada → validación automática básica → PDF local → carga manual a PredioAI`

La transferencia del número está implementada mediante el puente local experimental; la importación directa del PDF sigue **pendiente**. No requieren modificar el servicio Render para probar este prototipo.
