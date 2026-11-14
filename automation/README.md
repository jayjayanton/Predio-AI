# Consulta IRM asistida — prototipo de escritorio

Este módulo es **opcional** y funciona **localmente en Windows/macOS/Linux**. No se ejecuta automáticamente desde GitHub Pages ni desde Render. El usuario debe iniciar el script en su propio computador; el navegador Chromium que se abre pertenece a esa sesión local.

## Instalar (PowerShell, desde la raíz del repositorio)

```powershell
py -m pip install -r automation/requirements.txt
py -m playwright install chromium
```

## Ejecutar con el predio real

En PredioAI, consulte un predio y anote su **número de predio** (no la clave catastral). Luego:

```powershell
py automation/irm_playwright.py 627739
```

Sustituya `627739` por el número real seleccionado en PredioAI. El script **no recibe automáticamente el número desde el navegador**; esa integración requiere un componente local adicional.

1. Abre el portal oficial `buscarPredio.jsf` en Chromium visible.
2. Rellena el número de predio indicado.
3. **El usuario resuelve el CAPTCHA y pulsa CONSULTAR**. No se automatiza ni evade el CAPTCHA.
4. Espera hasta cinco minutos para detectar `/irm/irm.jsf` en la sesión del navegador (misma pestaña o pestaña nueva).
5. Verifica automáticamente que la página contiene la sección **Datos del Predio** y el número solicitado. Si falla, no exporta el archivo.
6. Genera `irm_downloads/IRM_<predio>.pdf` mediante impresión Chromium.
7. El usuario verifica que el PDF contenga todas las páginas y luego lo adjunta manualmente en **PredioAI → Proyecto y planos → IRM**.

**Limitaciones:** La detección de URL y las comprobaciones automáticas no garantizan que el informe esté completo; la salida de Chromium puede diferir de la opción de impresión oficial del Municipio. No se ha validado la exportación de un informe real. No suba informes sensibles a un sitio público sin revisar su tratamiento. El script no está conectado al backend Render ni al frontend GitHub Pages. Si el portal cambia de estructura, habrá que actualizar selectores y detección.

## Arquitectura prevista

`PredioAI (consulta catastral) → número de predio → ejecución local de Playwright → CAPTCHA manual → página IRM detectada → validación automática básica → PDF local → carga manual a PredioAI`

La transferencia automática desde el navegador público a la aplicación de escritorio y la importación directa del PDF quedan **pendientes**. No requieren modificar el servicio Render para probar este prototipo.
