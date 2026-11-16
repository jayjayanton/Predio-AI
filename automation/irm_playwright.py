"""Local desktop-assisted IRM acquisition. Not executed on Render or GitHub Pages.

Usage: py automation/irm_playwright.py 627739
The user solves the CAPTCHA in the visible Chromium browser.
"""
import argparse
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

SEARCH_URL = "https://pam.quito.gob.ec/mdmq_web_irm/irm/buscarPredio.jsf"
REPORT_PATH = "/irm/irm.jsf"


def main():
    parser = argparse.ArgumentParser(description="Consulta IRM asistida (escritorio)")
    parser.add_argument("predio", help="Número de predio consultado en PredioAI")
    parser.add_argument("--output-dir", default=str(Path.home() / "Downloads"), help="Carpeta local de salida (por defecto: Descargas del usuario)")
    args = parser.parse_args()
    predio = args.predio.strip()
    if not re.fullmatch(r"\d{1,25}", predio):
        parser.error("El número de predio debe contener entre 1 y 25 dígitos.")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        try:
            page.goto(SEARCH_URL, wait_until="domcontentloaded", timeout=60000)
            field = page.locator('[id="formDatos:txtParametro"]')
            field.wait_for(timeout=30000)
            field.fill(predio)
            print(f"Predio {predio} ingresado en el portal oficial.")
            print("Complete el CAPTCHA y pulse CONSULTAR en el navegador.")
            print("Esperando hasta 5 minutos para detectar la página de informe…")

            # The municipality may navigate in the same tab or open a new one.
            report_page = None
            import time
            deadline = time.monotonic() + 300
            while time.monotonic() < deadline:
                for candidate in context.pages:
                    if REPORT_PATH in candidate.url:
                        report_page = candidate
                        break
                if report_page:
                    break
                page.wait_for_timeout(500)

            if report_page is None:
                print("No se detectó el informe. Revise el CAPTCHA y la consulta.")
                return 1

            report_page.wait_for_load_state("domcontentloaded")
            print(f"Página del informe detectada: {report_page.url}")
            # Do not rely on URL alone: wait for meaningful report content.
            # The official report must show the requested predio before export.
            try:
                report_page.get_by_text("DATOS DEL PREDIO", exact=False).first.wait_for(timeout=30000)
            except PlaywrightTimeoutError:
                print("No se encontró la sección Datos del Predio; PDF no generado.")
                return 1

            report_text = report_page.locator("body").inner_text(timeout=15000)
            if predio not in report_text:
                print(f"El informe no muestra el predio {predio}; PDF no generado.")
                return 1

            print(f"Informe del predio {predio} detectado. Guardando PDF automáticamente…")

            output_dir = Path(args.output_dir).resolve()
            output_dir.mkdir(parents=True, exist_ok=True)
            output = output_dir / f"IRM_{predio}.pdf"
            # Chromium print output may differ from the municipal native print report.
            report_page.pdf(path=str(output), format="A4", print_background=True,
                            prefer_css_page_size=True)
            print(f"PDF preliminar guardado en: {output}")
            print("Revise todas las páginas del PDF antes de adjuntarlo a PredioAI.")
            return 0
        except PlaywrightTimeoutError as exc:
            print(f"Tiempo de espera agotado: {exc}")
            return 1
        finally:
            browser.close()


if __name__ == "__main__":
    raise SystemExit(main())
