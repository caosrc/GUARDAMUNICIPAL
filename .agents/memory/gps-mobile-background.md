---
name: GPS em segundo plano
description: Limites de geolocalização em navegadores móveis e como comunicar a retomada do rastreamento.
---

Geolocalização web depende da permissão do navegador e pode ser suspensa quando a página vai para segundo plano, especialmente em celulares. O app não consegue garantir um rastreamento contínuo com a tela fechada nem contornar uma permissão negada.

**Why:** A solicitação de manter o GPS sempre ativo precisa ser implementada como rastreamento contínuo enquanto a página está em execução, retomada quando o app volta ao primeiro plano e estados claros para sinal/permissão indisponíveis.

**How to apply:** Ative o GPS após a identificação do agente, use eventos de retorno à página para reabrir o watch, tente novamente apenas falhas temporárias e mantenha a última posição marcada como desatualizada quando não houver uma leitura recente. Não apresente localização antiga como posição ao vivo.