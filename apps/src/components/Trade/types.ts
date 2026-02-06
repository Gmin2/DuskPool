import type { CandlestickData, Time } from 'lightweight-charts';

export type ChartType = 'candle' | 'bar' | 'area' | 'line';
export type DrawingTool = 'cursor' | 'line' | 'hline' | 'trendline' | 'fib' | 'arrow' | 'text' | 'rect' | 'circle' | null;
export type HistoryTab = 'open' | 'orderHistory' | 'tradeHistory' | 'matches';
export type ChartView = 'price' | 'depth';

export interface AssetOption {
  address: string;
  symbol: string;
}

export interface Drawing {
  id: string;
  type: DrawingTool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface OrderBookEntry {
  price: number;
  size: number;
  total: number;
}

export interface OrderBookData {
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
  maxTotal: number;
}

export interface OpenOrder {
  id: string;
  time: string;
  pair: string;
  type: string;
  side: 'buy' | 'sell';
  price: string;
  amount: string;
  status: 'open' | 'filled' | 'cancelled' | 'pending';
  isOptimistic?: boolean;
}

export interface TradeRecord {
  id: string;
  time: string;
  pair: string;
  side: 'buy' | 'sell';
  price: string;
  amount: string;
  fee: string;
}

export type SettlementStatus = 'matched' | 'pending' | 'ready' | 'awaiting_signatures' | 'submitted' | 'confirmed' | 'failed';

export interface OffChainMatch {
  matchId: string;
  time: string;
  pair: string;
  buyTrader: string;
  sellTrader: string;
  price: string;
  quantity: string;
  status: SettlementStatus;
  txHash?: string;
  error?: string;
}

export interface ChartTypeOption {
  type: ChartType;
  label: string;
}

export interface DrawingToolOption {
  tool: DrawingTool;
  icon: React.ElementType;
  label: string;
}

export { CandlestickData, Time };
