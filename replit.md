# Defesa Civil Conselheiro Lafaiete — App de Gerenciamento de Ocorrências

## Run & Operate
- **Development + Production**: `pnpm install --frozen-lockfile && npm run build && node server/index.js`
- The Express server builds the Vite frontend and serves everything on **port 5000**
- `npm run dev` — Vite dev server (port 5000) with proxy to Express on port 3001 (dev only)
- `npm run build` — build frontend for production only

Required environment variables:
- `DATABASE_URL` — Replit PostgreSQL (auto-provisioned; do not set manually)
- `VAPID_PUBLIC_KEY` — VAPID public key (if push notifications are used)
- `VAPID_PRIVATE_KEY` — VAPID private key (secret, if push notifications are used)
- `VAPID_SUBJECT` — mailto: contact for VAPID (if push notifications are used)
- `PORT` — Express server port (set to 5000)
- `NODE_ENV` — set to `production`
- `EARTH_ENGINE_SERVICE_ACCOUNT_JSON` — Secret containing the complete Google Cloud service-account JSON key (optional)
- `EARTH_ENGINE_PROJECT` — optional Earth Engine/Google Cloud project ID
- `FIRMS_MAP_KEY` — Secret for NASA FIRMS active-fire data (optional)
- `PLANET_API_KEY` — Secret for Planet satellite imagery queries (optional)

## Stack
- **Frontend**: React 19 + TypeScript + Vite
- **Backend**: Express 5 + Node.js 20 + native WebSocket (`ws`) — port 5000
- **Database**: Replit PostgreSQL — schema auto-created by `initDb()` on server startup
- **Push Notifications**: Web Push (VAPID) via `web-push` on Express server
- **Maps**: Leaflet + react-leaflet (tiles proxied via `/api/tiles`)
- **Incêndios ativos**: NASA FIRMS (VIIRS NOAA-20/S-NPP, MODIS Terra/Aqua) + Google Earth Engine (GOES-19 ABI, MODIS e VIIRS), exibidos como focos e camadas no mapa
- **Chuva ao vivo**: RainViewer fornece o último quadro de radar meteorológico sobre o Leaflet; o limite oficial de Conselheiro Lafaiete é desenhado sobre a camada via OpenStreetMap/Nominatim
- **Camadas meteorológicas no mapa**: RainViewer usa metadados públicos observados e tiles dinâmicos; a intensidade CEMADEN é uma superfície IDW estimada entre as sete estações oficiais, sem marcadores; GOES/Nuvens só é ativado com `VITE_GOES_CLOUD_TILES_URL` HTTPS configurada; RRQPE permanece desligado até existir serviço real de rasterização
- **Imagens Planet**: consulta protegida pelo servidor em `/api/planet-focos`

## Where things live
- `server/index.js` — Express API + WebSocket server + DB init (`initDb`)
- `src/api.ts` — CRUD for ocorrências through Express
- `src/matApi.ts` — CRUD for materiais/emprestimos/campo (Express primary)
- `src/supabaseClient.ts` — compatibility stub permanently disabled; no external database client
- `src/wsClient.ts` — WebSocket client (connects to /ws)
- `src/pushNotifications.ts` — Web Push subscription via Express `/api/push-subscriptions`
- `src/components/` — React components per feature
- `src/offline.ts` — IndexedDB offline queue + cache
- `public/sw.js` — Service Worker (PWA, map tile cache)
- `attached_assets/` — report template (.docx)

## Architecture on Replit
- The Express server and Replit PostgreSQL are the complete application backend and data store for the Replit deployment
- The Vite frontend uses relative `/api` and `/ws` endpoints served by Express
- The Netlify deployment is configured in `netlify.toml` as a static Vite build (`dist`) with the compatible read-only/auxiliary Netlify Functions under `netlify/functions`
- Netlify does not provide this copy's persistent Express server, PostgreSQL or WebSocket endpoint; full CRUD, SOS persistence, push delivery and realtime tracking require the Replit server or a separately configured external backend

## Product
- Register and manage civil defense incidents with photos and GPS
- Real-time team tracking via WebSocket
- SOS alert system with Web Push notifications
- Agent schedule and hour bank management (escala)
- Vehicle checklist
- Materials, loans, and field equipment tracking (patrimônio)
- Inspection report generation (DOCX)
- KMZ/KML and Excel export
- Offline mode with sync queue (IndexedDB)

## User preferences
- App is mobile-first PWA for field teams
- Portuguese (pt-BR) UI

## Gotchas
- Push notifications require `VAPID_PRIVATE_KEY` secret to be set in Replit secrets
- Earth Engine requires the service account to have Earth Engine access and the `Service Usage Consumer` role on the Google Cloud project
- O botão **Chuva** mostra precipitação observada pelo radar RainViewer, atualizada automaticamente a cada 5 minutos, com legenda e limite municipal tracejado. A leitura em mm do centro é um resumo do Open-Meteo e não substitui pluviômetro local.
- A superfície **Intensidade CEMADEN** é uma estimativa interpolada (IDW), limitada ao raio visual de 10 km e atualizada junto com o endpoint oficial; dados ausentes não são preenchidos artificialmente.
- A camada **RRQPE NOAA** permanece indisponível no mapa enquanto não existir um serviço real que rasterize o produto NetCDF para tiles HTTPS; ela não é substituída por GOES, RainViewer ou dados inventados.
- O monitoramento do Earth Engine usa `FireMask >= 7` para MODIS/VIIRS e `Area > 0` para GOES-19 FDCF (cadência de 10 minutos); não interpreta chuva, radar, vegetação ou cicatriz de queimada como incêndio ativo
- O mapa consulta os focos NASA FIRMS e as camadas do Earth Engine para Conselheiro Lafaiete; a conta de serviço do Earth Engine precisa do acesso ao projeto e do papel Service Usage Consumer
- O painel CEMADEN lista todas as estações do município com os acumulados móveis de 1, 6, 12, 24, 48, 72 e 96 horas, além da leitura “Último”

## Pointers
- DB schema: `server/index.js` → `initDb()` function
- matApi methods: `src/matApi.ts`
- Push flow: `src/pushNotifications.ts` → Express `/api/push-subscriptions` → `/api/send-sos-push`
- WS events: `server/index.js` → `wss.on('connection')` handler
