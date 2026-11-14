"""Tests for optional 2026 geometry and AIVA enrichment."""
import pytest
from app import municipal

def parcel():
    return {"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[-78.46,-0.20],[-78.45,-0.20],[-78.45,-0.21],[-78.46,-0.20]]]},"properties":{"n_predio":"627739","codigo_aiv":"09570124","avaluo_tot":68193.13}}]}

@pytest.mark.asyncio
async def test_2026_merge(monkeypatch):
    async def newer(identifier):
        return {"geometry":{"type":"Polygon","coordinates":[[[1,1],[2,1],[1,1]]]},"properties":{"predio":627739,"SHAPE__Area":33098.63}}
    monkeypatch.setattr(municipal,"_lookup_2026_geometry",newer)
    before=parcel()
    after=await municipal._apply_2026_geometry("627739","n_predio",before)
    assert after["features"][0]["geometry"] != before["features"][0]["geometry"]
    assert after["features"][0]["properties"]["avaluo_tot"] == 68193.13

@pytest.mark.asyncio
async def test_2026_mismatch_fallback(monkeypatch):
    async def newer(identifier):
        return {"geometry":{"type":"Polygon","coordinates":[]},"properties":{"predio":123}}
    monkeypatch.setattr(municipal,"_lookup_2026_geometry",newer)
    original=parcel()
    assert await municipal._apply_2026_geometry("627739","n_predio",original)==original

@pytest.mark.asyncio
async def test_aiva_comparison(monkeypatch):
    async def fake(layer_id,point,zone_code):
        assert zone_code=="09570124"
        return {"rate_usd_m2":236 if layer_id==0 else 228,"zone_code":zone_code}
    monkeypatch.setattr(municipal,"_aiva_layer",fake)
    p=(await municipal._apply_aiva_comparison(parcel()))["features"][0]["properties"]
    assert p["_predioai_aiva_2024_usd_m2"]==228
    assert p["_predioai_aiva_2026_usd_m2"]==236
    assert p["_predioai_aiva_change_pct"]==3.51

@pytest.mark.asyncio
async def test_aiva_unavailable_fallback(monkeypatch):
    async def unavailable(layer_id,point,zone_code):
        return None
    monkeypatch.setattr(municipal,"_aiva_layer",unavailable)
    p=(await municipal._apply_aiva_comparison(parcel()))["features"][0]["properties"]
    assert p["avaluo_tot"]==68193.13
    assert "_predioai_aiva_2026_usd_m2" not in p
