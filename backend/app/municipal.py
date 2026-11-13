import os
import re
import httpx

BASE_URL = os.getenv('QUITO_ARCGIS_URL', 'https://geoquito.quito.gob.ec/server/rest/services/Hosted/predios_a_2024/FeatureServer/0/query')

class MunicipalError(Exception):
    pass

async def lookup_predio(number: str):
    if not re.fullmatch(r'[0-9]{1,25}', number):
        raise ValueError('Predio number must contain 1–25 digits')
    params = {
        'where': f"n_predio = '{number}'",
        'outFields': 'fid,predio,n_predio,clave_cata,area_const,area_terre,parroquia,uso_constr,zonificaci',
        'returnGeometry': 'true', 'outSR': '4326', 'f': 'geojson',
        'resultRecordCount': 10,
    }
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=False) as client:
            response = await client.get(BASE_URL, params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MunicipalError('Municipal service is unavailable or returned invalid data') from exc
    if 'error' in payload or payload.get('type') != 'FeatureCollection':
        raise MunicipalError('Municipal service returned an API error')
    return payload
