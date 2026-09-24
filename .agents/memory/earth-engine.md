---
name: Google Earth Engine
description: Requisitos para o monitoramento MODIS territorial de incêndios.
---

O monitoramento MODIS via Google Earth Engine depende de autenticação local da conta no ambiente que executa o servidor; a biblioteca instalada sozinha não autoriza o projeto.

**Why:** Sem uma sessão autenticada, a consulta ao catálogo e ao polígono municipal falha antes de retornar focos.

**How to apply:** Antes de investigar falhas de dados do Earth Engine, validar a autenticação e o projeto configurado. Manter o FIRMS como fonte complementar para o app continuar funcionando sem Earth Engine.

No Replit, a autenticação por conta de serviço usa o Secret `EARTH_ENGINE_SERVICE_ACCOUNT_JSON` e a biblioteca Python instalada no ambiente `.pythonlibs`. A conta também precisa da permissão `serviceusage.services.use` (papel `Service Usage Consumer`) no projeto do Google Cloud, além do acesso ao Earth Engine.

**Why:** A chave pode estar válida e ainda assim a API retornar “Caller does not have required permission to use project” antes de consultar o catálogo.

**How to apply:** Se a biblioteca e o Secret estiverem funcionando, conferir IAM do projeto e habilitação/acesso do Earth Engine no Google Cloud antes de alterar o código. Após adicionar ou alterar Secrets, reiniciar o workflow para o processo receber o novo ambiente.

O painel do mapa deve continuar exibindo ECOSTRESS, Sentinel-2, Landsat 8/9, Sentinel-1 e MODIS Fire mesmo quando o Earth Engine estiver sem autenticação; nesse estado, as ferramentas ficam sinalizadas como aguardando configuração e os focos FIRMS continuam disponíveis.

**Why:** A equipe precisa reconhecer as ferramentas disponíveis sem confundir a ausência temporária de credenciais com a ausência do recurso no aplicativo.

**How to apply:** Ao adicionar novas fontes de incêndio, preserve esse estado de catálogo visível e só habilite a sobreposição quando o servidor retornar uma URL de tiles válida.

O produto oficial GOES-19 para fogo no Earth Engine é `NOAA/GOES/19/FDCF`, com banda `Area > 0` e cadência de 10 minutos. `CT_MERG_FIRE` deve ser tratado como coleção complementar configurável, pois o nome sozinho não identifica uma coleção pública única.

**Why:** GOES-19 tem uma máscara e uma cadência diferentes de MODIS/VIIRS; aplicar `FireMask >= 7` nele produziria uma camada inválida. A coleção CT pode ser um asset específico da equipe.

**How to apply:** Usar `Area > 0` para o FDCF e configurar CT_MERG_FIRE por `EARTH_ENGINE_CT_MERG_FIRE_COLLECTION`, com banda, limiar, escala e período explícitos.