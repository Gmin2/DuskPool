import React, { useState, useEffect, useCallback } from 'react';
import { Filter, RefreshCw } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { useOrderbook } from '../hooks/useOrderbook';
import { useSettlement } from '../hooks/useSettlement';
import { useRegistry } from '../hooks/useRegistry';
import type { MatchRecord } from '../contracts/orderbook';
import type { SettlementRecord } from '../contracts/settlement';
import {
  StatusBadge, SideBadge,
  SearchInput, IconButton, Button,
  Card,
  Table, TableHeader, TableBody, TableRow, TableHeaderCell, TableCell,
  ControlledTabs,
  PageHeader,
  LoadingState, EmptyState,
} from './ui';

// Display interfaces
interface OrderDisplay {
  id: string;
  asset: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  filled: number;
  status: 'open' | 'partial' | 'filled' | 'cancelled';
  timestamp: string;
  hash: string;
}

interface SettlementDisplay {
  id: string;
  asset: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  timestamp: string;
  txHash: string;
}

// Format bigint amount (7 decimals)
const formatAmount = (amount: bigint): number => {
  return Number(amount) / 10_000_000;
};

// Format timestamp from u64
const formatTimestamp = (timestamp: bigint): string => {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Format buffer to hex string
const bufferToHex = (buffer: Buffer): string => {
  const hex = buffer.toString('hex');
  return `0x${hex.slice(0, 4)}...${hex.slice(-4)}`;
};

const History: React.FC = () => {
  const { address, isConnected } = useWallet();
  const { getMatches } = useOrderbook();
  const { getSettlements } = useSettlement();
  const { getActiveAssets } = useRegistry();

  const [activeTab, setActiveTab] = useState<'orders' | 'settlements'>('orders');
  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<OrderDisplay[]>([]);
  const [settlements, setSettlements] = useState<SettlementDisplay[]>([]);

  // Load asset symbols for display - returns symbols directly to avoid dependency cycle
  const loadAssetSymbols = useCallback(async (): Promise<Record<string, string>> => {
    try {
      const assets = await getActiveAssets();
      const symbols: Record<string, string> = {};
      assets.forEach(asset => {
        symbols[asset.token_address] = asset.symbol;
      });
      return symbols;
    } catch (err) {
      console.error('Failed to load asset symbols:', err);
      return {};
    }
  }, [getActiveAssets]);

  // Load matches (orders) for current user - accepts symbols to avoid dependency cycle
  const loadOrders = useCallback(async (symbols: Record<string, string>) => {
    if (!address) return;

    try {
      const allMatches = await getMatches();

      // Filter matches where user is buyer or seller
      const userMatches = allMatches.filter(
        (match: MatchRecord) => match.buyer === address || match.seller === address
      );

      // Convert to display format
      const orderData: OrderDisplay[] = userMatches.map((match: MatchRecord) => {
        const isBuyer = match.buyer === address;
        return {
          id: bufferToHex(match.match_id),
          asset: symbols[match.asset_address] || match.asset_address.slice(0, 8),
          side: isBuyer ? 'buy' : 'sell',
          amount: formatAmount(match.quantity),
          price: formatAmount(match.price),
          filled: match.is_settled ? formatAmount(match.quantity) : 0,
          status: match.is_settled ? 'filled' : 'partial',
          timestamp: formatTimestamp(match.timestamp),
          hash: isBuyer ? bufferToHex(match.buy_commitment) : bufferToHex(match.sell_commitment),
        };
      });

      setOrders(orderData);
    } catch (err) {
      console.error('Failed to load orders:', err);
      setOrders([]);
    }
  }, [address, getMatches]);

  // Load settlements for current user - accepts symbols to avoid dependency cycle
  const loadSettlements = useCallback(async (symbols: Record<string, string>) => {
    if (!address) return;

    try {
      const allSettlements = await getSettlements();

      // Filter settlements where user is buyer or seller
      const userSettlements = allSettlements.filter(
        (settlement: SettlementRecord) => settlement.buyer === address || settlement.seller === address
      );

      // Convert to display format
      const settlementData: SettlementDisplay[] = userSettlements.map((settlement: SettlementRecord) => {
        const isBuyer = settlement.buyer === address;
        return {
          id: bufferToHex(settlement.match_id),
          asset: symbols[settlement.asset_address] || settlement.asset_address.slice(0, 8),
          side: isBuyer ? 'buy' : 'sell',
          amount: formatAmount(settlement.quantity),
          price: formatAmount(settlement.price),
          timestamp: formatTimestamp(settlement.timestamp),
          txHash: bufferToHex(settlement.nullifier),
        };
      });

      setSettlements(settlementData);
    } catch (err) {
      console.error('Failed to load settlements:', err);
      setSettlements([]);
    }
  }, [address, getSettlements]);

  // Load all data - fetch symbols first, then pass to other loaders
  const loadData = useCallback(async () => {
    setIsLoading(true);
    const symbols = await loadAssetSymbols();
    await Promise.all([loadOrders(symbols), loadSettlements(symbols)]);
    setIsLoading(false);
  }, [loadAssetSymbols, loadOrders, loadSettlements]);

  useEffect(() => {
    if (isConnected) {
      loadData();
    } else {
      setOrders([]);
      setSettlements([]);
      setIsLoading(false);
    }
  }, [isConnected, loadData]);

  const tabs = [
    { key: 'orders' as const, label: 'Orders' },
    { key: 'settlements' as const, label: 'Settlements' },
  ];

  return (
    <div className="w-full h-full px-6 md:px-12 py-4 animate-fade-in-up overflow-auto">

      <div className="max-w-7xl mx-auto">

        {/* Header Controls */}
        <PageHeader
          title="Trade History"
          subtitle="Review your ZK-proof orders and on-chain settlements."
          actions={
            <>
              <IconButton
                icon={<RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}
                onClick={loadData}
              />
              <ControlledTabs
                tabs={tabs}
                activeTab={activeTab}
                onChange={setActiveTab}
                variant="pills"
              />
            </>
          }
        />

        {/* Filters Bar */}
        <Card variant="glass" className="mb-6 flex items-center gap-4">
           <div className="flex-1 max-w-xs">
              <SearchInput placeholder="Search Asset or ID..." />
           </div>
           <Button variant="secondary" size="md">
              <Filter className="w-4 h-4" /> Filter
           </Button>
        </Card>

        {/* Content Table */}
        <Card variant="glass" padding="none" className="overflow-hidden">
           {isLoading ? (
              <LoadingState message="Loading history..." />
           ) : !isConnected ? (
              <EmptyState title="Connect your wallet to view history" />
           ) : activeTab === 'orders' ? (
              orders.length === 0 ? (
                <EmptyState
                  title="No matched orders found"
                  description="Orders will appear here once they are matched"
                />
              ) : (
                <Table>
                   <TableHeader>
                      <tr>
                         <TableHeaderCell>Order ID / Hash</TableHeaderCell>
                         <TableHeaderCell>Date</TableHeaderCell>
                         <TableHeaderCell>Pair</TableHeaderCell>
                         <TableHeaderCell>Side</TableHeaderCell>
                         <TableHeaderCell align="right">Price</TableHeaderCell>
                         <TableHeaderCell align="right">Amount</TableHeaderCell>
                         <TableHeaderCell align="right">Filled</TableHeaderCell>
                         <TableHeaderCell align="center">Status</TableHeaderCell>
                         <TableHeaderCell align="right">Action</TableHeaderCell>
                      </tr>
                   </TableHeader>
                   <TableBody>
                      {orders.map((order) => (
                         <TableRow key={order.id}>
                            <TableCell>
                               <div className="font-mono text-xs text-white">#{order.id}</div>
                               <div className="font-mono text-[10px] text-gray-600">Commit: {order.hash}</div>
                            </TableCell>
                            <TableCell mono className="text-xs text-gray-400">{order.timestamp}</TableCell>
                            <TableCell className="text-sm font-bold text-white">{order.asset}/USDC</TableCell>
                            <TableCell><SideBadge side={order.side} /></TableCell>
                            <TableCell align="right" mono className="text-sm text-gray-300">${order.price.toFixed(2)}</TableCell>
                            <TableCell align="right" mono className="text-sm text-white">{order.amount.toLocaleString()}</TableCell>
                            <TableCell align="right" mono className="text-sm text-gray-400">{order.filled.toLocaleString()}</TableCell>
                            <TableCell align="center"><StatusBadge status={order.status} /></TableCell>
                            <TableCell align="right">
                               {order.status === 'open' || order.status === 'partial' ? (
                                  <Button variant="danger" size="sm">Cancel</Button>
                               ) : (
                                  <span className="text-gray-600">-</span>
                               )}
                            </TableCell>
                         </TableRow>
                      ))}
                   </TableBody>
                </Table>
              )
           ) : (
              settlements.length === 0 ? (
                <EmptyState
                  title="No settlements found"
                  description="Completed trades will appear here"
                />
              ) : (
                <Table>
                   <TableHeader>
                      <tr>
                         <TableHeaderCell>Settlement ID</TableHeaderCell>
                         <TableHeaderCell>Time</TableHeaderCell>
                         <TableHeaderCell>Pair</TableHeaderCell>
                         <TableHeaderCell>Side</TableHeaderCell>
                         <TableHeaderCell align="right">Price</TableHeaderCell>
                         <TableHeaderCell align="right">Amount</TableHeaderCell>
                         <TableHeaderCell align="right">Total Value</TableHeaderCell>
                         <TableHeaderCell align="right">Tx Hash</TableHeaderCell>
                      </tr>
                   </TableHeader>
                   <TableBody>
                      {settlements.map((set) => (
                         <TableRow key={set.id}>
                            <TableCell mono className="text-xs text-white">#{set.id}</TableCell>
                            <TableCell mono className="text-xs text-gray-400">{set.timestamp}</TableCell>
                            <TableCell className="text-sm font-bold text-white">{set.asset}/USDC</TableCell>
                            <TableCell><SideBadge side={set.side} /></TableCell>
                            <TableCell align="right" mono className="text-sm text-gray-300">${set.price.toFixed(2)}</TableCell>
                            <TableCell align="right" mono className="text-sm text-white">{set.amount.toLocaleString()}</TableCell>
                            <TableCell align="right" mono className="text-sm text-white">${(set.amount * set.price).toLocaleString()}</TableCell>
                            <TableCell align="right">
                               <a href="#" className="text-xs text-brand-stellar hover:underline font-mono">{set.txHash}</a>
                            </TableCell>
                         </TableRow>
                      ))}
                   </TableBody>
                </Table>
              )
           )}
        </Card>

      </div>
    </div>
  );
};

export default History;
