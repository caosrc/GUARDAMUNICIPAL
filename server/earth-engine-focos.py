#!/usr/bin/env python3
"""Consultas de detecção de incêndio do Google Earth Engine para Conselheiro Lafaiete."""

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
    """Retorna a geometria oficial de Conselheiro Lafaiete no catálogo do Earth Engine."""
    municipios = ee.FeatureCollection("FAO/GAUL/2015/level2")

    conselheiro_lafaiete = (
        municipios
        .filter(ee.Filter.eq("ADM2_NAME", "Conselheiro Lafaiete"))
        .filter(ee.Filter.eq("ADM1_NAME", "Minas Gerais"))
    )

    if conselheiro_lafaiete.size().getInfo() == 0:
        raise RuntimeError(
            "Município de Conselheiro Lafaiete não encontrado "
            "no catálogo do Earth Engine"
        )

    return conselheiro_lafaiete.geometry()


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
# GOES:
#   FDCF = Fire/Hot Spot Characterization, com atualização de 10 minutos.
SATELITES_FOGO = [
    {
        "id": "goes-19-fire",
        "nome": "GOES-R / GOES-19 ABI",
        "satelite": "GOES-19 ABI",
        "colecao": "NOAA/GOES/19/FDCF",
        "banda": "Area",
        "tipo_mascara": "area",
        "limiar": 0,
        "escala": 2000,
        "dias": 1,
        "periodo": "Últimas 24 horas · atualização a cada 10 min",
    },
    {
        "id": "modis-terra-fire",
        "nome": "MODIS Terra",
        "satelite": "MODIS Terra",
        "colecao": "MODIS/061/MOD14A1",
        "banda": "FireMask",
        "tipo_mascara": "firemask",
        "limiar": 7,
        "escala": 1000,
        "dias": 3,
        "periodo": "Últimos 3 dias",
    },
    {
        "id": "modis-aqua-fire",
        "nome": "MODIS Aqua",
        "satelite": "MODIS Aqua",
        "colecao": "MODIS/061/MYD14A1",
        "banda": "FireMask",
        "tipo_mascara": "firemask",
        "limiar": 7,
        "escala": 1000,
        "dias": 3,
        "periodo": "Últimos 3 dias",
    },
    {
        "id": "viirs-snpp-fire",
        "nome": "VIIRS Suomi-NPP",
        "satelite": "VIIRS Suomi-NPP",
        "colecao": "NASA/VIIRS/002/VNP14A1",
        "banda": "FireMask",
        "tipo_mascara": "firemask",
        "limiar": 7,
        "escala": 1000,
        "dias": 3,
        "periodo": "Últimos 3 dias",
    },
]


def obter_colecao_fogo(config, regiao, inicio, fim):
    """Retorna a coleção filtrada e a quantidade de imagens."""
    colecao = (
        ee.ImageCollection(config["colecao"])
        .filterDate(inicio, fim)
        .filterBounds(regiao)
        .select(config["banda"])
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


def mascara_fogo(imagem, config):
    """Converte a banda de cada produto em uma máscara binária de fogo."""
    banda = imagem.select(config["banda"])
    if config.get("tipo_mascara") == "area":
        return banda.gt(config.get("limiar", 0)).selfMask()
    return banda.gte(config.get("limiar", 7)).selfMask()


def extrair_focos(imagem, regiao, config, data_fim):
    """Converte pixels classificados como fogo em pontos."""
    if imagem is None:
        return []

    mascara = mascara_fogo(imagem, config)

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
      - GOES-19 ABI;
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

    # Earth Engine usa intervalo [início, fim); use o dia seguinte para
    # incluir as imagens disponíveis durante o dia atual.
    fim = (
        hoje + datetime.timedelta(days=1)
    ).strftime("%Y-%m-%d")
    inicio = (
        hoje - datetime.timedelta(days=3)
    ).strftime("%Y-%m-%d")

    camadas = []
    indicadores = []
    focos = []
    erros = []
    sem_dados = []
    disponibilidade = []

    for config in SATELITES_FOGO:
        try:
            dias = max(1, int(config.get("dias", 3)))
            inicio_config = (
                hoje - datetime.timedelta(days=dias)
            ).strftime("%Y-%m-%d")
            imagem, quantidade, disponivel = (
                imagem_fogo_ativo(
                    config,
                    regiao,
                    inicio_config,
                    fim,
                )
            )

            disponibilidade.append(
                {
                    "id": config["id"],
                    "nome": config["nome"],
                    "imagens": quantidade,
                    "disponivel": disponivel,
                    "periodo": config.get("periodo", ""),
                }
            )

            if not disponivel:
                sem_dados.append(
                    {
                        "id": config["id"],
                        "nome": config["nome"],
                        "periodo": f"{inicio_config} a {fim}",
                    }
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

            mascara = mascara_fogo(imagem, config)

            url = gerar_url_tiles(
                mascara,
                {
                    "min": 1,
                    "max": 1,
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
                        config.get("periodo") or f"Últimos {dias} dias até {fim}"
                    ),
                    "imagens": quantidade,
                    "frequencia": "10 minutos" if config["id"] == "goes-19-fire" else None,
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
        "semDados": sem_dados,
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

    # A rota principal combina estes focos com o NASA FIRMS e também usa
    # camadas/disponibilidade para montar o catálogo exibido no mapa.
    return resultado


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
                "camadas": resultado["camadas"],
                "disponibilidade": resultado["disponibilidade"],
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
