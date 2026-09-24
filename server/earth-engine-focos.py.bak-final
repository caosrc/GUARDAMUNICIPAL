#!/usr/bin/env python3
"""Consultas de monitoramento ambiental do Google Earth Engine para Ouro Branco."""

import datetime
import json
import os
import sys
import tempfile

import ee


def inicializar_earth_engine():
    """Inicializa o EE com a conta de serviço configurada no Secret."""
    chave_json = os.environ.get("EARTH_ENGINE_SERVICE_ACCOUNT_JSON", "").strip()

    if not chave_json:
        project_id = os.environ.get(
            "EARTH_ENGINE_PROJECT",
            "studio-6342191983-7ea1e",
        )
        ee.Initialize(project=project_id)
        return project_id

    try:
        dados = json.loads(chave_json)
        email = dados["client_email"]
        project_id = (
            os.environ.get("EARTH_ENGINE_PROJECT")
            or dados["project_id"]
        )

        arquivo = tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".json",
            prefix="ee-key-",
            delete=False,
        )

        try:
            json.dump(dados, arquivo)
            arquivo.close()
            os.chmod(arquivo.name, 0o600)

            credenciais = ee.ServiceAccountCredentials(
                email,
                arquivo.name,
            )

            ee.Initialize(
                credentials=credenciais,
                project=project_id,
            )

            return project_id

        finally:
            try:
                os.unlink(arquivo.name)
            except OSError:
                pass

    except (json.JSONDecodeError, KeyError) as exc:
        raise RuntimeError(
            "EARTH_ENGINE_SERVICE_ACCOUNT_JSON inválido: "
            "use o conteúdo completo da chave JSON"
        ) from exc


def obter_municipio():
    """Retorna a geometria oficial de Ouro Branco no catálogo do Earth Engine."""
    municipios = ee.FeatureCollection("FAO/GAUL/2015/level2")

    ouro_branco = (
        municipios
        .filter(ee.Filter.eq("ADM2_NAME", "Ouro Branco"))
        .filter(ee.Filter.eq("ADM1_NAME", "Minas Gerais"))
    )

    if ouro_branco.size().getInfo() == 0:
        raise RuntimeError(
            "Município de Ouro Branco não encontrado "
            "no catálogo do Earth Engine"
        )

    return ouro_branco.geometry()


def gerar_url_tiles(imagem, vis_params):
    """Gera URL de tiles assinada pelo Earth Engine."""
    mapa = imagem.getMapId(vis_params)
    return mapa["tile_fetcher"].url_format


def estatistica_media(
    imagem,
    regiao,
    escala=1000,
    banda=None,
    multiplicador=1,
):
    """Calcula uma média territorial sem interromper o monitoramento."""
    try:
        alvo = imagem.select(banda) if banda else imagem

        valor = alvo.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=regiao,
            scale=escala,
            bestEffort=True,
            maxPixels=100000000,
        ).getInfo()

        if not valor:
            return None

        numero = next(
            (
                v
                for v in valor.values()
                if isinstance(v, (int, float))
            ),
            None,
        )

        return (
            round(float(numero) * multiplicador, 2)
            if numero is not None
            else None
        )

    except Exception:
        return None


# Os produtos oficiais atuais do Earth Engine.
#
# MODIS:
#   MOD14A1 = Terra
#   MYD14A1 = Aqua
#
# VIIRS:
#   VNP14A1.002 = Suomi-NPP
#
# O antigo NOAA/VIIRS/001/VNP14A1 foi depreciado.
SATELITES_FOGO = [
    {
        "id": "modis-terra-fire",
        "nome": "MODIS Terra",
        "satelite": "MODIS Terra",
        "colecao": "MODIS/061/MOD14A1",
        "escala": 1000,
    },
    {
        "id": "modis-aqua-fire",
        "nome": "MODIS Aqua",
        "satelite": "MODIS Aqua",
        "colecao": "MODIS/061/MYD14A1",
        "escala": 1000,
    },
    {
        "id": "viirs-fire",
        "nome": "VIIRS Suomi-NPP",
        "satelite": "VIIRS Suomi-NPP",
        "colecao": "NASA/VIIRS/002/VNP14A1",
        "escala": 1000,
    },
]


def obter_colecao_fogo(config, regiao, inicio, fim):
    """Retorna a coleção filtrada e a quantidade de imagens."""
    colecao = (
        ee.ImageCollection(config["colecao"])
        .filterDate(inicio, fim)
        .filterBounds(regiao)
        .select("FireMask")
    )

    quantidade = colecao.size().getInfo()

    return colecao, int(quantidade)


def imagem_fogo_ativo(config, regiao, inicio, fim):
    """
    Retorna:
      - imagem agregada;
      - quantidade de imagens;
      - booleano indicando disponibilidade.

    Nunca chama .max() sobre coleção vazia.
    """
    colecao, quantidade = obter_colecao_fogo(
        config,
        regiao,
        inicio,
        fim,
    )

    if quantidade == 0:
        return None, 0, False

    return colecao.max(), quantidade, True


def extrair_focos(imagem, regiao, config, data_fim):
    """Converte pixels FireMask >= 7 em pontos."""
    if imagem is None:
        return []

    mascara = imagem.gte(7).selfMask()

    pontos = mascara.reduceToVectors(
        geometry=regiao,
        scale=config["escala"],
        geometryType="centroid",
        reducer=ee.Reducer.countEvery(),
        bestEffort=True,
        maxPixels=100000000,
    )

    resultado = pontos.getInfo()

    focos = []

    for feature in resultado.get("features", []):
        coords = (
            feature.get("geometry") or {}
        ).get("coordinates") or []

        if len(coords) < 2:
            continue

        focos.append(
            {
                "lat": float(coords[1]),
                "lng": float(coords[0]),
                "confidence": "h",
                "frp": 0,
                "data": data_fim,
                "hora": "",
                "satelite": config["satelite"],
                "fonte": (
                    f"EARTH-ENGINE-"
                    f"{config['id'].upper()}"
                ),
            }
        )

    return focos


def consultar_monitoramento():
    """
    Consulta detecção de incêndio ativo no Earth Engine.

    Fontes:
      - MODIS Terra;
      - MODIS Aqua;
      - VIIRS Suomi-NPP.

    Coleções sem dados no período são reportadas como
    indisponíveis, sem provocar erro de Image.gte.
    """
    project_id = inicializar_earth_engine()
    regiao = obter_municipio()

    hoje = datetime.datetime.now(
        datetime.timezone.utc
    ).date()

    fim = hoje.strftime("%Y-%m-%d")
    inicio = (
        hoje - datetime.timedelta(days=3)
    ).strftime("%Y-%m-%d")

    camadas = []
    indicadores = []
    focos = []
    erros = []
    disponibilidade = []

    for config in SATELITES_FOGO:
        try:
            imagem, quantidade, disponivel = (
                imagem_fogo_ativo(
                    config,
                    regiao,
                    inicio,
                    fim,
                )
            )

            disponibilidade.append(
                {
                    "id": config["id"],
                    "nome": config["nome"],
                    "imagens": quantidade,
                    "disponivel": disponivel,
                }
            )

            if not disponivel:
                erros.append(
                    f"{config['nome']}: "
                    f"nenhuma imagem disponível "
                    f"no período {inicio} a {fim}"
                )

                indicadores.append(
                    {
                        "id": f"{config['id']}-total",
                        "nome": f"Focos {config['nome']}",
                        "valor": 0,
                        "unidade": "detecção(ões)",
                        "disponivel": False,
                    }
                )

                continue

            mascara = imagem.gte(7).selfMask()

            url = gerar_url_tiles(
                mascara,
                {
                    "min": 7,
                    "max": 9,
                    "palette": [
                        "fef08a",
                        "f97316",
                        "dc2626",
                    ],
                },
            )

            focos_sat = extrair_focos(
                imagem,
                regiao,
                config,
                fim,
            )

            focos.extend(focos_sat)

            camadas.append(
                {
                    "id": config["id"],
                    "nome": config["nome"],
                    "descricao": (
                        "Focos de fogo ativo detectados "
                        f"pelo {config['nome']}."
                    ),
                    "url": url,
                    "periodo": (
                        f"Últimos 3 dias até {fim}"
                    ),
                    "imagens": quantidade,
                }
            )

            indicadores.append(
                {
                    "id": f"{config['id']}-total",
                    "nome": f"Focos {config['nome']}",
                    "valor": len(focos_sat),
                    "unidade": "detecção(ões)",
                    "disponivel": True,
                }
            )

        except Exception as exc:
            erros.append(
                f"{config['nome']}: "
                f"{str(exc)[:180]}"
            )

    return {
        "camadas": camadas,
        "focos": focos,
        "indicadores": indicadores,
        "disponibilidade": disponibilidade,
        "erros": erros,
        "projeto": project_id,
        "atualizadoEm": (
            datetime.datetime.now(
                datetime.timezone.utc
            ).isoformat()
        ),
        "periodo": {
            "inicio": inicio,
            "fim": fim,
        },
    }


def consultar_focos_ativos():
    """Consulta somente os pontos de fogo ativo."""
    resultado = consultar_monitoramento()

    return {
        "focos": resultado["focos"],
        "projeto": resultado["projeto"],
        "periodo": resultado["periodo"],
    }


def main():
    if (
        len(sys.argv) > 1
        and sys.argv[1] == "monitoramento"
    ):
        print(
            json.dumps(
                consultar_monitoramento(),
                ensure_ascii=False,
            )
        )
        return

    resultado = consultar_focos_ativos()

    print(
        json.dumps(
            {
                "focos": resultado["focos"],
                "fonte": (
                    "EARTH-ENGINE-MULTISATELITE"
                ),
                "projeto": resultado["projeto"],
                "periodo": resultado["periodo"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
