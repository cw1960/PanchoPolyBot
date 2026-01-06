import React, { useState, useEffect, useRef } from 'react';
import { BotConfig, PricePoint, TradeLog } from '../types';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { Play, Pause, Activity, TrendingUp, DollarSign, Terminal, Settings, Search, Check, Loader2, Network, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [activeMarkets, setActiveMarkets] = useState<string[]>([]);
  
  const [data, setData] = useState<PricePoint[]>([]);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [config, setConfig] = useState<BotConfig>({
    sourceExchange: 'Binance',
    targetMarket: 'bitcoin-up-or-down-january-6-2026-400pm-415pm-et',
    triggerThreshold: 5.0, // $5 delta
    betSize: 10,
    maxDailyLoss: 1000,
    latencyBufferMs: 2000
  });

  const [stats, setStats] = useState({
    balance: 313,
    profit: 0,
    wins: 0,
    losses: 0
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trades]);

  // Simulate scanning for Reference Prices
  useEffect(() => {
    if (isScanning) {
      const slugs = config.targetMarket.split(',').map(s => s.trim()).filter(s => s.length > 0);
      
      const timer = setTimeout(() => {
        setIsScanning(false);
        setIsRunning(true);
        const newActiveMarkets = slugs.flatMap((slug, index) => [
          `${slug.substring(0, 25)}... (Ref: $98,4${index}0)`
        ]);
        setActiveMarkets(newActiveMarkets);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isScanning, config.targetMarket]);

  // Up/Down Simulation Logic
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRunning) {
      interval = setInterval(() => {
        // In the Up/Down sim, we track deviation from 0 (Reference Price)
        // sourcePrice here acts as the "Live Price"
        // targetPrice acts as the "Reference Price" (Static)
        
        const now = Date.now();
        // Random walk around a base
        const base = 98000;
        const volatility = 15;
        const noise = (Math.random() - 0.5) * volatility * 2;
        
        // Accumulate noise to make it walk
        const lastPrice = data.length > 0 ? data[data.length-1].sourcePrice : base;
        const newPrice = lastPrice + noise;

        const newPoint: PricePoint = {
          timestamp: now,
          sourcePrice: newPrice,
          targetPrice: base, // The Static Reference Price
          delta: newPrice - base
        };
        
        setData(prev => {
          const newData = [...prev, newPoint];
          if (newData.length > 60) return newData.slice(newData.length - 60);
          return newData;
        });

        // Trade Logic: If Delta > Threshold, Buy UP. If Delta < -Threshold, Buy DOWN.
        const delta = newPoint.delta;
        
        if (Math.abs(delta) > config.triggerThreshold) {
          // 5% chance to trade per tick if condition met
          if (Math.random() > 0.90) {
              const isBullish = delta > 0;
              const type = isBullish ? 'BUY_UP' : 'BUY_DOWN';
              
              const isWin = Math.random() > 0.15; // 85% win rate in sim
              const profit = isWin ? config.betSize * 0.95 : -config.betSize;

              const randomMarketIndex = Math.floor(Math.random() * activeMarkets.length);
              const marketName = activeMarkets[randomMarketIndex]?.split(' ')[0] || 'Unknown';

              const completedTrade: TradeLog = {
                id: Math.random().toString(36).substr(2, 6),
                timestamp: now,
                type: type,
                asset: marketName,
                entryPrice: isBullish ? 0.90 : 0.90, // Price we paid per share
                marketPrice: newPrice,
                amount: config.betSize,
                status: isWin ? 'WON' : 'LOST',
                profit: profit
              };

              setTrades(prev => [...prev, completedTrade]);
              setStats(prev => ({
                balance: prev.balance + profit,
                profit: prev.profit + profit,
                wins: isWin ? prev.wins + 1 : prev.wins,
                losses: !isWin ? prev.losses + 1 : prev.losses
              }));
          }
        }

      }, 200);
    }
    return () => clearInterval(interval);
  }, [isRunning, config, activeMarkets, data]);

  const handleStart = () => {
    if (isRunning) {
      setIsRunning(false);
      setActiveMarkets([]);
      setData([]);
    } else {
      setIsScanning(true);
    }
  };

  const winRate = stats.wins + stats.losses > 0 
    ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1) 
    : '0.0';

  return (
    <div className="h-screen flex flex-col p-4 gap-4 overflow-hidden">
      {/* Top Bar */}
      <header className="flex justify-between items-center bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
        <div className="flex items-center gap-3">
           <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
           <h1 className="text-xl font-mono font-bold tracking-tight text-white">PANCHO<span className="text-emerald-500">POLY</span>BOT_v3.1</h1>
           <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded border border-zinc-700">BINARY_MODE</span>
        </div>
        
        <div className="flex items-center gap-6 text-sm font-mono">
           <div className="flex items-center gap-2">
             <span className="text-zinc-500">BALANCE:</span>
             <span className="text-emerald-400 font-bold">${stats.balance.toFixed(2)}</span>
           </div>
           <div className="flex items-center gap-2">
             <span className="text-zinc-500">P/L:</span>
             <span className={stats.profit >= 0 ? "text-emerald-400" : "text-red-400"}>
               {stats.profit >= 0 ? '+' : ''}${stats.profit.toFixed(2)}
             </span>
           </div>
           <div className="flex items-center gap-2">
             <span className="text-zinc-500">WIN RATE:</span>
             <span className="text-blue-400">{winRate}%</span>
           </div>
        </div>

        <button
          onClick={handleStart}
          disabled={isScanning}
          className={`flex items-center gap-2 px-4 py-2 rounded font-bold transition-colors w-40 justify-center ${
            isRunning 
              ? 'bg-red-900/50 text-red-200 hover:bg-red-900' 
              : 'bg-emerald-900/50 text-emerald-200 hover:bg-emerald-900'
          }`}
        >
          {isScanning ? <Loader2 className="animate-spin" size={16}/> : (isRunning ? <Pause size={16} /> : <Play size={16} />)}
          {isScanning ? 'RESOLVING' : (isRunning ? 'STOP' : 'START')}
        </button>
      </header>

      <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">
        
        {/* Left Column: Chart & config */}
        <div className="col-span-8 flex flex-col gap-4">
          
          {/* Chart Container */}
          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-400">
                <Activity size={16} /> 
                REFERENCE DELTA VISUALIZER
              </h2>
              {data.length > 0 && (
                <div className="flex items-center gap-4">
                   <div className="text-xs text-zinc-500">
                     REF PRICE: <span className="text-white font-mono">${data[data.length-1].targetPrice.toFixed(2)}</span>
                   </div>
                   <div className="text-xs text-zinc-500">
                     LIVE: <span className="text-emerald-400 font-mono">${data[data.length-1].sourcePrice.toFixed(2)}</span>
                   </div>
                </div>
              )}
            </div>
            
            <div className="flex-1 w-full min-h-0 relative">
               {/* Visual zones */}
               <div className="absolute top-0 left-0 w-full h-1/2 bg-emerald-500/5 pointer-events-none border-b border-zinc-700/50 flex items-end justify-end p-2">
                 <span className="text-emerald-500/20 text-xs font-bold uppercase">Winning Zone (UP)</span>
               </div>
               <div className="absolute bottom-0 left-0 w-full h-1/2 bg-red-500/5 pointer-events-none flex items-start justify-end p-2">
                 <span className="text-red-500/20 text-xs font-bold uppercase">Losing Zone (DOWN)</span>
               </div>

              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <YAxis domain={['dataMin - 10', 'dataMax + 10']} stroke="#52525b" fontSize={12} hide />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46' }}
                    itemStyle={{ fontSize: '12px' }}
                    labelFormatter={() => ''}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
                  />
                  {/* Reference Line (The Open Price) */}
                  <ReferenceLine y={98000} stroke="#71717a" strokeDasharray="3 3" />
                  
                  <Line 
                    type="stepAfter" 
                    dataKey="sourcePrice" 
                    stroke="#10b981" 
                    strokeWidth={2} 
                    dot={false}
                    isAnimationActive={false} 
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Config Panel */}
          <div className="h-48 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-400 mb-4">
              <Settings size={16} /> 
              BINARY STRATEGY PARAMS
            </h2>
            <div className="grid grid-cols-3 gap-6">
              
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Target Slugs (Up/Down)</label>
                <div className="flex items-center gap-2 bg-zinc-950 p-2 rounded border border-zinc-800 focus-within:border-emerald-500 transition-colors">
                  <Search size={14} className="text-zinc-600" />
                  <input 
                    type="text" 
                    value={config.targetMarket}
                    onChange={(e) => setConfig({...config, targetMarket: e.target.value})}
                    placeholder="btc-up-down-jan6"
                    className="bg-transparent text-sm text-white focus:outline-none w-full font-mono"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Min Delta to Trigger ($)</label>
                <div className="flex items-center gap-2 bg-zinc-950 p-2 rounded border border-zinc-800">
                  <TrendingUp size={14} className="text-zinc-600" />
                  <input 
                    type="number" 
                    step="0.5"
                    value={config.triggerThreshold}
                    onChange={(e) => setConfig({...config, triggerThreshold: parseFloat(e.target.value)})}
                    className="bg-transparent text-sm text-white focus:outline-none w-full font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1">Bet Size (USDC)</label>
                <div className="flex items-center gap-2 bg-zinc-950 p-2 rounded border border-zinc-800">
                  <DollarSign size={14} className="text-zinc-600" />
                  <input 
                    type="number" 
                    value={config.betSize}
                    onChange={(e) => setConfig({...config, betSize: parseFloat(e.target.value)})}
                    className="bg-transparent text-sm text-white focus:outline-none w-full font-mono"
                  />
                </div>
              </div>
            </div>
            <p className="mt-4 text-xs text-zinc-600 font-mono">
              {isScanning 
                ? 'STATUS: Fetching Binance Open Prices...' 
                : (isRunning ? `STATUS: Calculating Live Deltas for ${activeMarkets.length} markets...` : 'STATUS: Idle')}
            </p>
          </div>

        </div>

        {/* Right Column: Logs */}
        <div className="col-span-4 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col">
          <div className="p-3 border-b border-zinc-800 flex justify-between items-center">
             <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-400">
                <Terminal size={16} /> 
                SIGNAL LOG
             </h2>
             <span className="text-xs text-zinc-600 font-mono">{trades.length} fills</span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-2">
            {activeMarkets.length > 0 && (
              <div className="mb-4 pb-4 border-b border-zinc-900">
                <div className="text-zinc-400 font-bold mb-2 flex items-center gap-2">
                  <Network size={12}/> Locked Refs:
                </div>
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {activeMarkets.map((m, i) => (
                    <div key={i} className="text-zinc-600 truncate pl-2 border-l border-zinc-800">{m}</div>
                  ))}
                </div>
              </div>
            )}
            
            {trades.length === 0 && !isRunning && (
              <div className="text-zinc-700 text-center mt-10 italic">Waiting for signal...</div>
            )}
            {trades.map((trade) => (
              <div key={trade.id} className="border-b border-zinc-900 pb-2">
                <div className="flex justify-between text-zinc-500 mb-1">
                  <span>{new Date(trade.timestamp).toLocaleTimeString()}</span>
                  <span>{trade.id}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={`flex items-center gap-1 font-bold ${trade.type.includes('UP') ? 'text-emerald-500' : 'text-red-500'}`}>
                    {trade.type.includes('UP') ? <ArrowUpCircle size={12}/> : <ArrowDownCircle size={12}/>}
                    {trade.type.replace('BUY_', '')}
                  </span>
                  <span className="text-zinc-300">${trade.amount}</span>
                </div>
                <div className="text-zinc-400 mt-1 font-bold truncate">
                   {trade.asset}
                </div>
                <div className="text-zinc-500 mt-1">
                  Price: ${trade.marketPrice.toFixed(0)}
                </div>
                <div className={`text-right mt-1 ${trade.profit && trade.profit > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {trade.profit && trade.profit > 0 ? '+' : ''}{trade.profit?.toFixed(2)} USD
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

      </div>
    </div>
  );
};