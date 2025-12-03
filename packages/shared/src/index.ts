// Token types
export interface Token {
  id: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUri?: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  price?: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  liquidity?: number;
  createdAt: string;
  updatedAt: string;
}

// OHLCV types
export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";

// API response types
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface TokenListParams {
  page?: number;
  limit?: number;
  sort?: "marketCap" | "volume" | "priceChange" | "createdAt";
  order?: "asc" | "desc";
  search?: string;
}

export interface OHLCVParams {
  timeframe?: Timeframe;
  from?: number;
  to?: number;
  limit?: number;
}

// WebSocket event types
export interface PriceUpdateEvent {
  type: "price:update";
  data: {
    address: string;
    price: number;
    timestamp: number;
  };
}

export interface CandleUpdateEvent {
  type: "candle:update";
  data: {
    address: string;
    timeframe: Timeframe;
    candle: OHLCV;
  };
}

export type WebSocketEvent = PriceUpdateEvent | CandleUpdateEvent;

// Birdeye API types
export interface BirdeyeTokenData {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
  logoURI?: string;
  liquidity: number;
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
}

export interface BirdeyeOHLCVData {
  unixTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

// Jupiter API types
export interface JupiterToken {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  tags?: string[];
}
