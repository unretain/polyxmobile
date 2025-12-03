# PumpLab: 3D Solana Memecoin Charting Platform

## Vision
Build a web application that aggregates all Solana memecoins and displays their price data in immersive 3D charts - like axiom.trade but with a unique 3D visualization experience.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                       │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Token List   │  │ Token Detail │  │ 3D Chart Viewer        │ │
│  │ - Search     │  │ - Stats      │  │ - Three.js Scene       │ │
│  │ - Filters    │  │ - Info       │  │ - 3D Candlesticks      │ │
│  │ - Trending   │  │ - Trades     │  │ - OrbitControls        │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                    State Management (Zustand)                    │
├─────────────────────────────────────────────────────────────────┤
│                    WebSocket Connection Layer                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (Node.js/Express)                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ API Routes   │  │ WebSocket    │  │ Data Aggregator        │ │
│  │ /tokens      │  │ Server       │  │ - Birdeye Integration  │ │
│  │ /ohlcv       │  │ - Real-time  │  │ - Jupiter Integration  │ │
│  │ /trending    │  │   updates    │  │ - Pump.fun Tracker     │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                         Cache Layer (Redis)                      │
├─────────────────────────────────────────────────────────────────┤
│                      Database (PostgreSQL)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend
- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript
- **3D Engine:** Three.js + React Three Fiber (@react-three/fiber)
- **3D Controls:** @react-three/drei (OrbitControls, etc.)
- **Styling:** Tailwind CSS
- **State:** Zustand
- **Real-time:** Socket.io-client
- **UI Components:** shadcn/ui

### Backend
- **Runtime:** Node.js
- **Framework:** Express.js or Fastify
- **Language:** TypeScript
- **WebSocket:** Socket.io
- **Database:** PostgreSQL (via Prisma ORM)
- **Cache:** Redis (for rate limiting + caching API responses)
- **Job Queue:** BullMQ (for background data fetching)

### Data Sources (Priority Order)
1. **Birdeye API** - Primary OHLCV data source
2. **Jupiter API** - Token list and price validation (free)
3. **Helius RPC** - Blockchain data and WebSocket events
4. **DexScreener** - Fallback/supplementary data

---

## Implementation Phases

### Phase 1: Project Setup & Basic Infrastructure
1. Initialize Next.js project with TypeScript
2. Set up Tailwind CSS + shadcn/ui
3. Create basic layout (header, sidebar, main content)
4. Set up Express backend with TypeScript
5. Configure PostgreSQL + Prisma schema
6. Set up Redis for caching

### Phase 2: Data Layer
1. Integrate Jupiter API for token list
2. Integrate Birdeye API for OHLCV data
3. Create token sync job (fetch all Solana memecoins)
4. Build OHLCV data fetching service
5. Implement caching strategy
6. Create REST API endpoints:
   - `GET /api/tokens` - List all tokens with pagination
   - `GET /api/tokens/:address` - Token details
   - `GET /api/tokens/:address/ohlcv` - OHLCV data for charting
   - `GET /api/trending` - Trending tokens

### Phase 3: 3D Charting Engine
1. Set up React Three Fiber scene
2. Create 3D candlestick geometry component
3. Implement candlestick positioning along time axis
4. Add color coding (green/red based on price direction)
5. Implement OrbitControls (zoom, pan, rotate)
6. Add grid/axis helpers for orientation
7. Create volume bars as 3D bars on separate plane
8. Implement smooth camera transitions

### Phase 4: Real-time Updates
1. Set up Socket.io server
2. Implement WebSocket connection to Birdeye/Helius
3. Stream price updates to frontend
4. Update 3D chart in real-time
5. Add visual effects for new candles (glow, animation)

### Phase 5: Token Discovery & UI
1. Build token list page with search/filter
2. Create token detail page
3. Implement trending tokens section
4. Add token metadata display (logo, name, symbol, socials)
5. Build responsive mobile layout

### Phase 6: Advanced Features
1. Multiple timeframe support (1m, 5m, 15m, 1h, 4h, 1d)
2. Technical indicators in 3D (moving averages as 3D ribbons)
3. Multi-token comparison view (side-by-side 3D charts)
4. Watchlist functionality
5. Price alerts
6. Dark/light theme

---

## 3D Chart Design Specification

### Candlestick 3D Representation
```
        ┌─┐  ← High (wick top)
        │ │
    ┌───┴─┴───┐  ← Open or Close (body top)
    │         │
    │  Body   │  ← Filled box (green = up, red = down)
    │         │
    └───┬─┬───┘  ← Open or Close (body bottom)
        │ │
        └─┘  ← Low (wick bottom)
```

### 3D Space Layout
```
     Y-axis (Price)
        ↑
        │
        │    ┌───┐ ┌───┐ ┌───┐
        │    │   │ │   │ │   │  ← Candlesticks
        │    └───┘ └───┘ └───┘
        │
        └────────────────────→ X-axis (Time)
       /
      /
     Z-axis (Depth - for visual effect or volume)
```

### Camera Controls
- **Orbit:** Rotate around chart center
- **Zoom:** Scroll to zoom in/out
- **Pan:** Right-click drag to pan
- **Reset:** Double-click to reset view
- **Presets:** Top-down view, Side view, 3D perspective

### Visual Effects
- Subtle glow on latest candle
- Gradient background (dark theme)
- Grid lines on floor plane
- Price scale on Y-axis
- Time labels on X-axis
- Smooth transitions when new data arrives

---

## Database Schema (Prisma)

```prisma
model Token {
  id              String   @id @default(cuid())
  address         String   @unique
  symbol          String
  name            String
  decimals        Int
  logoUri         String?
  description     String?
  website         String?
  twitter         String?
  telegram        String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Cached market data
  price           Float?
  priceChange24h  Float?
  volume24h       Float?
  marketCap       Float?
  liquidity       Float?

  ohlcv           OHLCV[]

  @@index([symbol])
  @@index([marketCap])
}

model OHLCV {
  id        String   @id @default(cuid())
  tokenId   String
  token     Token    @relation(fields: [tokenId], references: [id])

  timestamp DateTime
  timeframe String   // "1m", "5m", "15m", "1h", "4h", "1d"
  open      Float
  high      Float
  low       Float
  close     Float
  volume    Float

  @@unique([tokenId, timestamp, timeframe])
  @@index([tokenId, timeframe, timestamp])
}

model Watchlist {
  id        String   @id @default(cuid())
  userId    String   // For future auth
  tokenId   String
  createdAt DateTime @default(now())

  @@unique([userId, tokenId])
}
```

---

## API Endpoints

### Tokens
```
GET  /api/tokens
     ?page=1&limit=50
     &sort=marketCap|volume|priceChange
     &order=asc|desc
     &search=keyword

GET  /api/tokens/:address

GET  /api/tokens/:address/ohlcv
     ?timeframe=1m|5m|15m|1h|4h|1d
     &from=timestamp
     &to=timestamp
```

### Trending
```
GET  /api/trending
     ?period=1h|6h|24h
     &limit=20
```

### WebSocket Events
```
subscribe:token     { address: string }
unsubscribe:token   { address: string }
price:update        { address, price, timestamp }
candle:update       { address, timeframe, ohlcv }
```

---

## File Structure

```
pumplab/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx        # Home/token list
│   │   │   ├── token/
│   │   │   │   └── [address]/
│   │   │   │       └── page.tsx
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── ui/             # shadcn components
│   │   │   ├── layout/
│   │   │   │   ├── Header.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── Footer.tsx
│   │   │   ├── tokens/
│   │   │   │   ├── TokenList.tsx
│   │   │   │   ├── TokenCard.tsx
│   │   │   │   └── TokenSearch.tsx
│   │   │   └── charts/
│   │   │       ├── Chart3D.tsx
│   │   │       ├── Candlestick3D.tsx
│   │   │       ├── VolumeBar3D.tsx
│   │   │       ├── ChartControls.tsx
│   │   │       └── ChartAxis.tsx
│   │   ├── lib/
│   │   │   ├── api.ts
│   │   │   ├── socket.ts
│   │   │   └── utils.ts
│   │   ├── stores/
│   │   │   ├── tokenStore.ts
│   │   │   └── chartStore.ts
│   │   └── hooks/
│   │       ├── useTokens.ts
│   │       ├── useOHLCV.ts
│   │       └── useSocket.ts
│   │
│   └── api/                    # Express backend
│       ├── src/
│       │   ├── index.ts
│       │   ├── routes/
│       │   │   ├── tokens.ts
│       │   │   └── trending.ts
│       │   ├── services/
│       │   │   ├── birdeye.ts
│       │   │   ├── jupiter.ts
│       │   │   ├── tokenSync.ts
│       │   │   └── ohlcvFetcher.ts
│       │   ├── websocket/
│       │   │   └── index.ts
│       │   ├── jobs/
│       │   │   ├── syncTokens.ts
│       │   │   └── fetchOHLCV.ts
│       │   └── utils/
│       │       └── cache.ts
│       └── prisma/
│           └── schema.prisma
│
├── packages/
│   └── shared/                 # Shared types/utils
│       ├── types/
│       │   └── index.ts
│       └── utils/
│           └── index.ts
│
├── docker-compose.yml          # PostgreSQL + Redis
├── package.json
├── turbo.json                  # Turborepo config
└── README.md
```

---

## Environment Variables

```env
# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001

# Backend
DATABASE_URL=postgresql://user:pass@localhost:5432/pumplab
REDIS_URL=redis://localhost:6379

# API Keys
BIRDEYE_API_KEY=your_key_here
HELIUS_API_KEY=your_key_here
```

---

## Development Milestones

### MVP (Week 1-2)
- [ ] Basic project setup
- [ ] Token list from Jupiter API
- [ ] Basic 3D chart with static data
- [ ] Single token view

### Beta (Week 3-4)
- [ ] Birdeye OHLCV integration
- [ ] Real-time price updates
- [ ] Multiple timeframes
- [ ] Search and filters
- [ ] Responsive design

### v1.0 (Week 5-6)
- [ ] Performance optimization
- [ ] Advanced 3D features
- [ ] Watchlist
- [ ] Trending tokens
- [ ] Polish and bug fixes

---

## Key Decisions & Trade-offs

### Why Three.js + React Three Fiber?
- Maximum flexibility for custom 3D candlestick rendering
- React integration via R3F for state management
- Large community and ecosystem
- No licensing costs (vs SciChart, LightningChart)

### Why Birdeye over alternatives?
- Best OHLCV data support for Solana
- High rate limits (300 req/s)
- Multiple timeframes (1s to 1d)
- WebSocket support on paid plans

### Why monorepo with Turborepo?
- Shared types between frontend/backend
- Single repository for all code
- Efficient caching and builds
- Easy to add more packages later

### Caching Strategy
- Redis for API response caching (5-60 second TTL)
- PostgreSQL for persistent OHLCV history
- Frontend: React Query with 30s stale time

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Birdeye rate limits | High | Cache aggressively, queue requests, consider paid plan |
| 3D performance on mobile | Medium | Reduce polygon count, simpler shaders, fallback to 2D |
| WebSocket reliability | Medium | Reconnection logic, fallback to polling |
| Data accuracy | High | Cross-reference multiple sources, validate outliers |

---

## Future Enhancements (Post v1.0)
- User authentication
- Portfolio tracking
- Trading integration (swap directly)
- AI-powered price predictions
- Social features (share charts)
- Mobile native app
- More chains (Base, Ethereum, etc.)
