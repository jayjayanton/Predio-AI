import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from .municipal import lookup_predio, MunicipalError

app = FastAPI(title='PredioAI API', version='0.1.0')
origins = os.getenv('CORS_ORIGINS', 'http://localhost:5173').split(',')
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['GET','POST'], allow_headers=['*'])

@app.get('/api/health')
def health():
    return {'status': 'ok'}

@app.get('/api/predios/{number}')
async def predio(number: str):
    try:
        data = await lookup_predio(number)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except MunicipalError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not data['features']:
        raise HTTPException(status_code=404, detail='Predio not found')
    return data

MAX_UPLOAD = 15 * 1024 * 1024
@app.post('/api/blueprints/inspect')
async def inspect_blueprint(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail='Only PDF documents are supported')
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail='PDF exceeds 15 MB limit')
    if not data.startswith(b'%PDF-'):
        raise HTTPException(status_code=400, detail='Invalid PDF signature')
    try:
        import fitz
        document = fitz.open(stream=data, filetype='pdf')
        pages = len(document)
        if pages == 0 or pages > 100:
            raise ValueError('Invalid page count')
        page_info = []
        for page in document:
            page_info.append({'page': page.number + 1, 'width_pt': round(page.rect.width, 2),
                              'height_pt': round(page.rect.height, 2),
                              'vector_drawings': len(page.get_drawings()),
                              'text_characters': len(page.get_text())})
        document.close()
    except Exception as exc:
        raise HTTPException(status_code=422, detail='Unable to parse PDF') from exc
    return {'filename': Path(file.filename).name, 'pages': pages, 'page_info': page_info,
            'stored': False, 'measurements_available': False}
