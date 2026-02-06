import React from 'react';
import type { HistoryTab, OpenOrder, TradeRecord, OffChainMatch, SettlementStatus } from './types';

interface OffChainMatchExtended extends OffChainMatch {
  buyerSigned?: boolean;
  sellerSigned?: boolean;
  role?: 'buyer' | 'seller';
}

interface TradeHistoryProps {
  activeTab: HistoryTab;
  setActiveTab: (tab: HistoryTab) => void;
  openOrders: OpenOrder[];
  orderHistory: OpenOrder[];
  tradeHistory: TradeRecord[];
  offChainMatches?: OffChainMatchExtended[];
  onSettleMatch?: (matchId: string) => void;
  onSignMatch?: (matchId: string) => void;
  isSettling?: boolean;
  isSigning?: boolean;
}

const getStatusColor = (status: SettlementStatus): string => {
  switch (status) {
    case 'matched': return 'bg-blue-500';
    case 'pending': return 'bg-yellow-500 animate-pulse';
    case 'ready': return 'bg-orange-500';
    case 'awaiting_signatures': return 'bg-amber-500 animate-pulse';
    case 'submitted': return 'bg-purple-500 animate-pulse';
    case 'confirmed': return 'bg-emerald-500';
    case 'failed': return 'bg-red-500';
    default: return 'bg-gray-500';
  }
};

const getStatusText = (status: SettlementStatus): string => {
  switch (status) {
    case 'matched': return 'Matched';
    case 'pending': return 'Processing';
    case 'ready': return 'Ready';
    case 'awaiting_signatures': return 'Awaiting Sigs';
    case 'submitted': return 'Submitted';
    case 'confirmed': return 'Settled';
    case 'failed': return 'Failed';
    default: return status;
  }
};

export const TradeHistory: React.FC<TradeHistoryProps> = ({
  activeTab,
  setActiveTab,
  openOrders,
  orderHistory,
  tradeHistory,
  offChainMatches = [],
  onSettleMatch,
  onSignMatch,
  isSettling = false,
  isSigning = false,
}) => {
  return (
    <div className="h-48 shrink-0 bg-zinc-900/50 backdrop-blur-sm border border-white/5 overflow-hidden flex flex-col">
      {/* Tabs */}
      <div className="flex items-center gap-6 px-4 py-3 border-b border-white/5">
        <button
          onClick={() => setActiveTab('open')}
          className={`text-xs font-medium pb-3 -mb-3.5 transition-colors ${
            activeTab === 'open' ? 'text-white font-bold border-b-2 border-brand-stellar' : 'text-gray-500 hover:text-white'
          }`}
        >
          Open Orders ({openOrders.length})
        </button>
        <button
          onClick={() => setActiveTab('orderHistory')}
          className={`text-xs font-medium pb-3 -mb-3.5 transition-colors ${
            activeTab === 'orderHistory' ? 'text-white font-bold border-b-2 border-brand-stellar' : 'text-gray-500 hover:text-white'
          }`}
        >
          Order History
        </button>
        <button
          onClick={() => setActiveTab('tradeHistory')}
          className={`text-xs font-medium pb-3 -mb-3.5 transition-colors ${
            activeTab === 'tradeHistory' ? 'text-white font-bold border-b-2 border-brand-stellar' : 'text-gray-500 hover:text-white'
          }`}
        >
          Trade History
        </button>
        <button
          onClick={() => setActiveTab('matches')}
          className={`text-xs font-medium pb-3 -mb-3.5 transition-colors ${
            activeTab === 'matches' ? 'text-white font-bold border-b-2 border-emerald-500' : 'text-gray-500 hover:text-white'
          }`}
        >
          Matches ({offChainMatches.length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'matches' ? (
          <table className="w-full text-left border-collapse">
            <thead className="bg-white/5 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Time</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Pair</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Buyer</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Seller</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider text-right">Price</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider text-right">Quantity</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider text-right">Status</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs font-mono text-gray-300">
              {offChainMatches.map(match => (
                <tr key={match.matchId} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-gray-500">{match.time}</td>
                  <td className="px-4 py-3 font-bold text-white">{match.pair}</td>
                  <td className="px-4 py-3 text-emerald-500/80">{match.buyTrader.slice(0, 8)}...</td>
                  <td className="px-4 py-3 text-rose-500/80">{match.sellTrader.slice(0, 8)}...</td>
                  <td className="px-4 py-3 text-right">{match.price}</td>
                  <td className="px-4 py-3 text-right">{match.quantity}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2 items-center">
                      <span className={`w-2 h-2 ${getStatusColor(match.status)}`}></span>
                      <span>{getStatusText(match.status)}</span>
                    </div>
                    {match.txHash && (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${match.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-brand-stellar hover:underline"
                      >
                        {match.txHash.slice(0, 8)}...
                      </a>
                    )}
                    {match.error && (
                      <span className="text-[10px] text-red-400" title={match.error}>
                        Error
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {match.status === 'ready' && onSettleMatch && (
                      <button
                        onClick={() => onSettleMatch(match.matchId)}
                        disabled={isSettling}
                        className="px-3 py-1 text-[10px] bg-brand-stellar/20 text-brand-stellar hover:bg-brand-stellar/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isSettling ? 'Settling...' : 'Settle'}
                      </button>
                    )}
                    {match.status === 'awaiting_signatures' && onSignMatch && (
                      <div className="flex flex-col items-center gap-1">
                        {/* Show who has signed */}
                        <div className="flex gap-1 text-[9px]">
                          <span className={match.buyerSigned ? 'text-emerald-400' : 'text-gray-500'}>
                            B:{match.buyerSigned ? '✓' : '○'}
                          </span>
                          <span className={match.sellerSigned ? 'text-emerald-400' : 'text-gray-500'}>
                            S:{match.sellerSigned ? '✓' : '○'}
                          </span>
                        </div>
                        {/* Show Sign button if this user hasn't signed yet */}
                        {((match.role === 'buyer' && !match.buyerSigned) ||
                          (match.role === 'seller' && !match.sellerSigned)) && (
                          <button
                            onClick={() => onSignMatch(match.matchId)}
                            disabled={isSigning}
                            className="px-3 py-1 text-[10px] bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {isSigning ? 'Signing...' : 'Sign'}
                          </button>
                        )}
                        {/* Already signed message */}
                        {((match.role === 'buyer' && match.buyerSigned) ||
                          (match.role === 'seller' && match.sellerSigned)) && (
                          <span className="text-emerald-400 text-[9px]">Signed ✓</span>
                        )}
                      </div>
                    )}
                    {match.status === 'confirmed' && (
                      <span className="text-emerald-500 text-[10px]">✓ Done</span>
                    )}
                    {match.status === 'failed' && onSettleMatch && (
                      <button
                        onClick={() => onSettleMatch(match.matchId)}
                        disabled={isSettling}
                        className="px-3 py-1 text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Retry
                      </button>
                    )}
                    {(match.status === 'pending' || match.status === 'submitted') && (
                      <span className="text-gray-500 text-[10px]">Processing...</span>
                    )}
                  </td>
                </tr>
              ))}
              {offChainMatches.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">No matches yet</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : activeTab === 'tradeHistory' ? (
          <table className="w-full text-left border-collapse">
            <thead className="bg-white/5 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Time</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Pair</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Side</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider text-right">Price</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider text-right">Amount</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider text-right">Fee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs font-mono text-gray-300">
              {tradeHistory.map(trade => (
                <tr key={trade.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-gray-500">{trade.time}</td>
                  <td className="px-4 py-3 font-bold text-white">{trade.pair}</td>
                  <td className={`px-4 py-3 ${trade.side === 'buy' ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
                    {trade.side === 'buy' ? 'Buy' : 'Sell'}
                  </td>
                  <td className="px-4 py-3 text-right">{trade.price}</td>
                  <td className="px-4 py-3 text-right">{trade.amount}</td>
                  <td className="px-4 py-3 text-right text-gray-500">${trade.fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-white/5 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Time</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Pair</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Type</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider">Side</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider text-right">Price</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider text-right">Amount</th>
                <th className="px-4 py-2 text-[10px] text-gray-500 uppercase font-normal tracking-wider text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs font-mono text-gray-300">
              {(activeTab === 'open' ? openOrders : orderHistory).map(order => (
                <tr key={order.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-gray-500">{order.time}</td>
                  <td className="px-4 py-3 font-bold text-white">{order.pair}</td>
                  <td className="px-4 py-3 text-brand-stellar">{order.type}</td>
                  <td className={`px-4 py-3 ${order.side === 'buy' ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
                    {order.side === 'buy' ? 'Buy' : 'Sell'}
                  </td>
                  <td className="px-4 py-3 text-right">{order.price}</td>
                  <td className="px-4 py-3 text-right">{order.amount}</td>
                  <td className="px-4 py-3 text-right flex justify-end gap-2 items-center">
                    {order.status === 'pending' && <span className="w-2 h-2 bg-blue-500 animate-pulse"></span>}
                    {order.status === 'open' && <span className="w-2 h-2 bg-yellow-500 animate-pulse"></span>}
                    {order.status === 'filled' && <span className="w-2 h-2 bg-emerald-500/70"></span>}
                    {order.status === 'cancelled' && <span className="w-2 h-2 bg-gray-500"></span>}
                    <span className="capitalize">{order.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
