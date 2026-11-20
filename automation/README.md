# Consulta IRM asistida — Docker local

Este módulo opcional ejecuta Python, Playwright y Chromium dentro de Docker. El usuario no necesita instalar Python, abrir PowerShell ni escribir comandos. El CAPTCHA del portal municipal se completa manualmente en un navegador local visible.

El asistente sigue siendo software local: no se ejecuta en Render, no intenta evadir el CAPTCHA y no envía el IRM a PredioAI. Después de obtenerlo, el usuario revisa el PDF y lo adjunta manualmente.

## Inicio en Windows

1. Instale y abra [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Descargue esta carpeta `automation` junto con el `Dockerfile` y los archivos del repositorio.
3. Haga doble clic en `automation/start_docker_windows.bat`.
4. En el primer inicio, espere mientras Docker prepara la imagen. Al terminar se abre el navegador local del asistente en `http://127.0.0.1:6080`.
5. Abra PredioAI, seleccione un predio y pulse **Consulta asistida en escritorio**.
6. Regrese al navegador local del asistente, complete el CAPTCHA y pulse **CONSULTAR**.
7. Cuando se valide el informe, el archivo `IRM_<predio>.pdf` aparece en la carpeta **Descargas** de Windows.

Para detener el asistente, haga doble clic en `automation/stop_docker_windows.bat`. Docker puede volver a iniciarlo posteriormente con el archivo de inicio.

`automation/setup_windows.bat` se conserva como acceso compatible y ahora abre el mismo iniciador de Docker.

## Qué incluye el contenedor

- Python y la versión fijada de Playwright.
- Chromium y sus dependencias del sistema.
- Una pantalla virtual local accesible mediante noVNC en `127.0.0.1:6080`.
- El puente local de PredioAI en `127.0.0.1:8765`.
- Un volumen que escribe el PDF generado en Descargas, fuera del contenedor.

Los puertos se publican únicamente en `127.0.0.1`; otros equipos de la red no pueden conectarse a ellos. La pantalla noVNC no usa contraseña porque solo está disponible en el mismo computador. El puente comprueba el origen exacto, valida el número de predio y permite una sola consulta activa.

## Integración con PredioAI

La aplicación envía el número seleccionado a `http://127.0.0.1:8765/irm/start`. El contenedor abre el portal municipal en Chromium, rellena el número y espera hasta cinco minutos a que el usuario resuelva el CAPTCHA y abra el informe.

El flujo es:

`PredioAI → número de predio → puente Docker local → Chromium visible → CAPTCHA manual → validación básica → PDF en Descargas → carga manual a PredioAI`

Chrome o Edge pueden pedir permiso para que una página HTTPS acceda a un servicio de red local. Ese permiso debe concederse para usar el botón integrado. Si el navegador bloquea la conexión, use **Copiar número**, abra el portal oficial y pegue el número manualmente.

## Dominio comercial

El contenedor acepta de forma predeterminada el demo de GitHub Pages y los orígenes locales de desarrollo. Cuando exista el dominio comercial, añada su origen HTTPS exacto a `IRM_ALLOWED_ORIGINS`.

Para una configuración local, copie `automation/.env.example` como `automation/.env` y cambie la variable, por ejemplo:

```text
IRM_ALLOWED_ORIGINS=https://app.predioai.ec,https://jayjayanton.github.io
```

No use `*` y no incluya rutas ni barras finales. El archivo `.env` no se confirma en Git.

## Ejecución avanzada

Desde la carpeta `automation`, la configuración equivalente es:

```powershell
docker compose up -d --build
docker compose down
```

El modo Python local anterior continúa disponible para desarrollo:

```powershell
py -m pip install -r automation/requirements.txt
py -m playwright install chromium
py automation/irm_bridge.py
```

El contenedor es la opción destinada a usuarios de escritorio porque evita instalar y mantener esas dependencias por separado.

## Límites

- El usuario siempre resuelve el CAPTCHA.
- La importación automática del PDF a PredioAI no está implementada.
- La detección de la página y del número de predio no certifica que el informe esté completo.
- La impresión de Chromium puede diferir de la opción oficial del portal.
- Si el portal cambia sus campos, URL o estructura, habrá que actualizar los selectores.
- Docker Desktop sigue siendo un requisito. Para distribución comercial a usuarios sin Docker, el siguiente paso sería empaquetar un instalador de escritorio firmado o publicar una imagen preconstruida y un iniciador controlado.
