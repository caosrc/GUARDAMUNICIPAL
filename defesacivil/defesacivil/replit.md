# Defesa Civil de Ouro Branco — Sistema de Vistorias

## Visão Geral
Sistema web completo de registro e gerenciamento de ocorrências para a Defesa Civil de Ouro Branco (MG).

## Arquitetura
- **Frontend**: React 19 + TypeScript + Vite 5 (porta 5000 em desenvolvimento)
- **Backend**: Express.js API REST (porta 3001 em desenvolvimento, PORT env em produção)
- **Banco de Dados**: Replit PostgreSQL (DATABASE_URL)
- **Mapa**: React-Leaflet com OpenStreetMap e opção de visão satélite
- **Exportação**: KMZ via JSZip, Excel via ExcelJS
- **Relatórios**: DOCX gerado a partir do modelo anexado em `attached_assets`

## Estrutura
```
/
├── server/
│   └── index.js          # API Express + serve frontend em produção
├── src/
│   ├── App.tsx            # App principal — lista + mapa
│   ├── App.css            # Estilos — tema azul/laranja Defesa Civil
│   ├── types.ts           # Tipos TypeScript + constantes (naturezas, ícones, cores)
│   ├── api.ts             # Funções de fetch para a API
│   ├── exportExcel.ts     # Exportação Excel
│   ├── offline.ts         # Suporte offline / Service Worker
│   └── components/
│       ├── NovaOcorrencia.tsx     # Formulário completo de registro
│       ├── MapaOcorrencias.tsx    # Mapa Leaflet com marcadores coloridos
│       ├── ChecklistViatura.tsx   # Checklists de viatura
│       └── DetalheOcorrencia.tsx  # Modal de detalhe + exportar KMZ individual
├── public/
│   └── sw.js              # Service Worker
├── vite.config.ts         # Proxy /api → localhost:3001, host 0.0.0.0, porta 5000
└── package.json
```

## Workflows
- **Start application**: `npm run start` → inicia a API Express na porta 3001 e o Vite na porta 5000 (webview), com proxy `/api` e `/ws` para manter separação cliente/servidor em desenvolvimento.

## Deployment
- Build: `npx vite build` (gera dist/ sem bloquear a publicação por validações TypeScript de desenvolvimento)
- Run: `node server/index.js` (serve API + frontend estático da dist/)
- Target: autoscale

## Banco de Dados
O servidor valida `DATABASE_URL` na inicialização e cria automaticamente as tabelas necessárias se elas ainda não existirem. A migração para Replit usa o PostgreSQL integrado com as variáveis `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` e `PGDATABASE` provisionadas pelo ambiente.

### Tabela `ocorrencias`
| Campo | Tipo | Descrição |
|---|---|---|
| id | SERIAL | Chave primária |
| tipo | VARCHAR(255) | Vistoria, Diligência, Apoio, Outro |
| natureza | VARCHAR(255) | Tipo de natureza (Árvore, Incêndio, etc.) |
| subnatureza | VARCHAR(255) | Detalhe condicional (estrutura ou animal) |
| nivel_risco | VARCHAR(100) | baixo, medio, alto |
| status_oc | VARCHAR(100) | ativo, resolvido |
| fotos | JSONB | Array de base64 |
| lat | DOUBLE PRECISION | Latitude GPS |
| lng | DOUBLE PRECISION | Longitude GPS |
| endereco | TEXT | Endereço manual |
| proprietario | VARCHAR(255) | Nome do proprietário/morador |
| observacoes | TEXT | Texto livre |
| data_ocorrencia | TIMESTAMP | Data da ocorrência |
| agentes | JSONB | Array de agentes empenhados |
| created_at | TIMESTAMP | Data/hora automática |

### Tabela `checklists_viatura`
| Campo | Tipo | Descrição |
|---|---|---|
| id | SERIAL | Chave primária |
| data_checklist | DATE | Data do checklist |
| km | VARCHAR(100) | Quilometragem informada |
| motorista | VARCHAR(255) | Motorista selecionado |
| fotos_avarias | JSONB | Fotos de avarias em base64 |
| foto_principal | TEXT | Foto principal do veículo |
| foto_frontal | TEXT | Foto frontal do veículo |
| foto_traseira | TEXT | Foto traseira do veículo |
| foto_direita | TEXT | Foto lateral direita |
| foto_esquerda | TEXT | Foto lateral esquerda |
| observacoes | TEXT | Texto livre |
| assinatura_data | TEXT | Assinatura digital em base64 capturada via tela sensível ao toque |
| created_at | TIMESTAMP | Data/hora automática |

## Funcionalidades
- Formulário com campos (tipo → natureza → subnatureza condicional → nível → status → fotos → GPS/endereço → proprietário → agentes → observações → data)
- Mapa centrado em Ouro Branco com alternância entre visão padrão e satélite, marcadores por tipo (emoji + cor)
- Botões de GPS na nova ocorrência e no mapa sempre tentam novamente; se o navegador tiver bloqueado a permissão, o app orienta liberar Localização nas permissões do site/app e tentar de novo.
- Popup no marcador com botão "Ver detalhes"
- Modal de detalhe com exportação KMZ individual
- Edição de coordenadas no detalhe da ocorrência feita apenas em graus, minutos e segundos, com direção N/S e L/O; o app converte internamente para latitude/longitude decimal ao salvar.
- Botão “Salvar relatório” no detalhe da ocorrência, gerando DOCX com dados, coordenadas em graus/minutos/segundos e até 6 fotos
- Exportação KMZ global de todas as ocorrências com GPS
- Exportação Excel de todas as ocorrências
- Filtros por nível, status e busca de texto
- Resumo numérico no topo (Alto, Médio, Baixo, Total)
- Checklists de viatura com fotos por ângulo, avarias, assinatura digital, histórico, exportação Excel geral e PDF individual via impressão do navegador
- Aba Escala no menu inferior com calendário ADM, sobreaviso diário, férias/folgas prolongadas e banco de horas; no calendário de Sobreaviso o responsável é marcado por dia, e o ADM mostra automaticamente “Folga:” no dia seguinte para quem ficou de sobreaviso.
- Suporte offline completo via PWA (Service Worker + IndexedDB + manifest)
- Rastreamento em tempo real no mapa via WebSocket: a aba Mapa conecta ao servidor mesmo com o GPS local desligado, permitindo ver outros agentes online que estejam com GPS ativo.

## Suporte Offline Completo (PWA)
- **PWA instalável**: `manifest.json` + meta tags para instalação no celular (Android e iOS)
- **Convite de instalação**: banner no app para criar ícone na tela inicial do celular; no iPhone orienta usar Compartilhar → Adicionar à Tela de Início.
- **Service Worker (sw.js)**: cache separado para tiles do mapa e app shell; tiles OSM cacheados automaticamente; placeholder cinza quando offline; recebe mensagens do app para pré-cachear região de Ouro Branco (zoom 12–16)
- **Botão "📥 Offline" no mapa**: baixa tiles da região (zoom 12–16, ~700–1000 tiles), mostra progresso, e permite apagar cache
- **GPS offline**: `navigator.geolocation.watchPosition` funciona por hardware do dispositivo, independente de conexão
- **Geocodificação offline**: fallback com pontos de referência de Ouro Branco (bairros, hospital, escola etc.)
- **Fila de pendentes**: ocorrências salvas offline sincronizadas automaticamente ao reconectar
- **IndexedDB**: armazena ocorrências pendentes e cache do servidor
