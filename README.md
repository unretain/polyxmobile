# PumpLab - 3D Solana Memecoin Charts

A web application that aggregates all Solana memecoins and displays their price data in immersive 3D charts. Like axiom.trade but with 3D visualization.

![PumpLab](https://via.placeholder.com/800x400?text=PumpLab+3D+Charts)

## Features

- **3D Price Charts**: Interactive candlestick charts rendered in 3D using Three.js
- **Real-time Updates**: Live price data via WebSocket connections
- **Token Discovery**: Browse and search thousands of Solana memecoins
- **Trending Tokens**: See what's hot on Solana
- **Multiple Timeframes**: 1m, 5m, 15m, 1H, 4H, 1D chart views
- **Volume Visualization**: 3D volume bars alongside price data

## Tech Stack

### Frontend
- Next.js 15 (App Router)
- TypeScript
- Three.js + React Three Fiber
- Tailwind CSS
- Zustand (state management)
- Socket.io-client

### Backend
- Node.js + Express
- TypeScript
- PostgreSQL + Prisma
- Redis (caching)
- Socket.io

### Data Sources
- Birdeye API (OHLCV data)
- Jupiter API (token list)

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for PostgreSQL and Redis)
- Birdeye API key (optional - mock data works without it)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/pumplab.git
cd pumplab
```

2. Install dependencies:
```bash
npm install
```

3. Start the database services:
```bash
docker-compose up -d
```

4. Set up environment variables:
```bash
# Copy example env files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Edit apps/api/.env and add your API keys
```

5. Initialize the database:
```bash
cd apps/api
npx prisma db push
```

6. Start the development servers:
```bash
# From root directory
npm run dev
```

The frontend will be available at http://localhost:3000
The API will be available at http://localhost:3001

## Project Structure

```
pumplab/
├── apps/
│   ├── web/                 # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/         # App router pages
│   │   │   ├── components/  # React components
│   │   │   │   ├── charts/  # 3D chart components
│   │   │   │   ├── layout/  # Layout components
│   │   │   │   └── tokens/  # Token list components
│   │   │   ├── lib/         # Utilities
│   │   │   └── stores/      # Zustand stores
│   │   └── ...
│   │
│   └── api/                 # Express backend
│       ├── src/
│       │   ├── routes/      # API routes
│       │   ├── services/    # External API integrations
│       │   ├── lib/         # Utilities
│       │   └── websocket/   # WebSocket handlers
│       └── prisma/          # Database schema
│
├── packages/
│   └── shared/              # Shared TypeScript types
│
├── docker-compose.yml       # PostgreSQL + Redis
└── turbo.json               # Turborepo config
```

## API Endpoints

### Tokens
- `GET /api/tokens` - List tokens with pagination
- `GET /api/tokens/:address` - Get single token
- `GET /api/tokens/:address/ohlcv` - Get OHLCV chart data

### Trending
- `GET /api/trending` - Get trending tokens
- `GET /api/trending/gainers` - Top gainers
- `GET /api/trending/losers` - Top losers

### WebSocket Events
- `subscribe:token` - Subscribe to token updates
- `unsubscribe:token` - Unsubscribe from token
- `price:update` - Receive price updates

## 3D Chart Controls

- **Rotate**: Left-click + drag
- **Zoom**: Scroll wheel
- **Pan**: Right-click + drag
- **Reset**: Double-click

## Environment Variables

### Backend (apps/api/.env)
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pumplab"
REDIS_URL="redis://localhost:6379"
BIRDEYE_API_KEY="your_api_key"
PORT=3001
FRONTEND_URL="http://localhost:3000"
```

### Frontend (apps/web/.env)
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

## Development

```bash
# Run both frontend and backend
npm run dev

# Run only frontend
npm run dev:web

# Run only backend
npm run dev:api

# Database commands
npm run db:push      # Push schema changes
npm run db:generate  # Generate Prisma client
```

## License

MIT
