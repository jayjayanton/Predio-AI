import asyncio
import pytest
from unittest.mock import Mock, patch
from app.municipal import lookup_predio

@pytest.mark.parametrize('bad', ['1 OR 1=1', "1'", '-1', 'abc', '1;DROP'])
def test_reject_invalid_identifiers(bad):
    with pytest.raises(ValueError):
        asyncio.run(lookup_predio(bad))

def test_query_params():
    payload = {'type': 'FeatureCollection', 'features': []}
    with patch('app.municipal.httpx.AsyncClient') as cls:
        client = cls.return_value.__aenter__.return_value
        response = Mock()
        client.get.return_value = response
        response.raise_for_status.return_value = None
        response.json.return_value = payload
        assert asyncio.run(lookup_predio('1280416019')) == payload
        params = client.get.call_args.kwargs['params']
        assert params['where'] == "clave_cata = '1280416019'"
        assert params['outSR'] == '4326'
