import React, { useState, useEffect, useRef } from 'react';
import { BotConfig, PricePoint, TradeLog } from '../types';
import { generateMarketData, checkTradeCondition } from '../services/simulationService';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Play, Pause, Activity, TrendingUp, DollarSign, Terminal, Settings, Search, Check, Loader2 } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [activeMarkets, setActiveMarkets] = useState<string[]>([]);
  
  const [data, setData] = useState<PricePoint[]>([]);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [config, setConfig] = useState<BotConfig>({
    sourceExchange: 'Binance',
    targetMarket: 'bitcoin-price-hit-100k-jan', // Default Slug
    triggerThreshold: 0.3,
    betSize: 313,
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

  // Auto-scroll logs
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trades]);

  // Scanning Simulation
  useEffect(() => {
    if (isScanning) {
      const timer = setTimeout(() => {
        setIsScanning(false);
        setIsRunning(true);
        setActiveMarkets([
          `YES: ${config.targetMarket} (ID: 0x82...9a)`,
          `NO: ${config.targetMarket} (ID: 0x12...b4)`
        ]);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isScanning, config.targetMarket]);

  // Trading Simulation Loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRunning) {
      interval = setInterval(() => {
        const newPoint = generateMarketData(3);
        
        setData(prev => {
          const newData = [...prev, newPoint];
          if (newData.length > 50) return newData.slice(newData.length - 50);
          return newData;
        });

        const tradeSignal = checkTradeCondition(newPoint, config);
        
        if (tradeSignal) {
          const isWin = Math.random() > 0.10;
          const profit = isWin ? tradeSignal.amount * 0.8 : -tradeSignal.amount;
          
          const completedTrade: TradeLog = {
            ...tradeSignal,
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

      }, 500);
    }
    return () => clearInterval(interval);
  }, [isRunning, config]);

  const handleStart = () => {
    if (isRunning) {
      setIsRunning(false);
      setActiveMarkets([]);
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
           <h1 className="text-xl font-mono font-bold tracking-tight text-white">PANCHO<span className="text-emerald-500">POLY</span>BOT_v1.1</h1>
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
          {isScanning ? 'SCANNING' : (isRunning ? 'HALT' : 'INITIATE')}
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
                LATENCY VISUALIZER
              </h2>
              {activeMarkets.length > 0 && (
                <div className="flex items-center gap-2 text-xs bg-emerald-900/30 text-emerald-400 px-2 py-1 rounded border border-emerald-900">
                  <Check size={12} /> Live Tracking: {config.targetMarket}
                </div>
              )}
            </div>
            
            <div className="flex-1 w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="timestamp" hide />
                  <YAxis domain={['auto', 'auto']} stroke="#52525b" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46' }}
                    itemStyle={{ fontSize: '12px' }}
                    labelFormatter={() => ''}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="sourcePrice" 
                    stroke="#10b981" 
                    strokeWidth={2} 
                    dot={false}
                    isAnimationActive={false} 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="targetPrice" 
                    stroke="#3b82f6" 
                    strokeWidth={2} 
                    strokeDasharray="5 5" 
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
              BOT PARAMETERS
            </h2>
            <div className="grid grid-cols-3 gap-6">
              
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Polymarket Slug / Keyword</label>
                <div className="flex items-center gap-2 bg-zinc-950 p-2 rounded border border-zinc-800 focus-within:border-emerald-500 transition-colors">
                  <Search size={14} className="text-zinc-600" />
                  <input 
                    type="text" 
                    value={config.targetMarket}
                    onChange={(e) => setConfig({...config, targetMarket: e.target.value})}
                    placeholder="e.g. bitcoin-above-100k"
                    className="bg-transparent text-sm text-white focus:outline-none w-full font-mono"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Trigger Threshold (%)</label>
                <div className="flex items-center gap-2 bg-zinc-950 p-2 rounded border border-zinc-800">
                  <TrendingUp size={14} className="text-zinc-600" />
                  <input 
                    type="number" 
                    step="0.1"
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
                ? 'STATUS: Querying Gamma API for Token IDs...' 
                : (isRunning ? 'STATUS: Monitoring Price Deltas...' : 'STATUS: Standby')}
            </p>
          </div>

        </div>

        {/* Right Column: Logs */}
        <div className="col-span-4 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col">
          <div className="p-3 border-b border-zinc-800 flex justify-between items-center">
             <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-400">
                <Terminal size={16} /> 
                EXECUTION LOG
             </h2>
             <span className="text-xs text-zinc-600 font-mono">{trades.length} events</span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-2">
            {activeMarkets.length > 0 && (
              <div className="mb-4 pb-4 border-b border-zinc-900">
                <div className="text-zinc-400 font-bold mb-2">Active Market IDs:</div>
                {activeMarkets.map((m, i) => (
                  <div key={i} className="text-zinc-600 truncate">{m}</div>
                ))}
              </div>
            )}
            
            {trades.length === 0 && !isRunning && (
              <div className="text-zinc-700 text-center mt-10 italic">Ready to initialize.</div>
            )}
            {trades.map((trade) => (
              <div key={trade.id} className="border-b border-zinc-900 pb-2">
                <div className="flex justify-between text-zinc-500 mb-1">
                  <span>{new Date(trade.timestamp).toLocaleTimeString()}</span>
                  <span>ID: {trade.id}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={trade.type === 'BUY_YES' ? 'text-emerald-500 font-bold' : 'text-red-500 font-bold'}>
                    {trade.type}
                  </span>
                  <span className="text-zinc-300">${trade.amount}</span>
                </div>
                <div className="text-zinc-500 mt-1">
                  Alert: Spot moved to {trade.marketPrice.toFixed(0)}, Poly at {trade.entryPrice.toFixed(0)}
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