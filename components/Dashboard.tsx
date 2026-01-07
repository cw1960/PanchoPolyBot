import React, { useState, useEffect, useRef } from 'react';
import { BotConfig, PricePoint, TradeLog } from '../types';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { Play, Pause, Activity, TrendingUp, DollarSign, Terminal, Settings, Search, Check, Loader2, Network, ArrowUpCircle, ArrowDownCircle, Info, Wifi, WifiOff, Copy, FolderSearch, RefreshCw, AlertTriangle, XCircle, ArrowRight } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [activeMarket, setActiveMarket] = useState<string>('Scanning Markets...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [newSlug, setNewSlug] = useState('');
  
  const [data, setData] = useState<PricePoint[]>([]);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [config, setConfig] = useState<BotConfig>({
    sourceExchange: 'Binance',
    targetMarket: 'Unknown',
    triggerThreshold: 0, 
    betSize: 0,
    maxDailyLoss: 0,
    latencyBufferMs: 0
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trades]);

  // --- REAL WEBSOCKET CONNECTION ---
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    
    const connect = () => {
        if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const socket = new WebSocket('ws://localhost:8080');
        ws.current = socket;

        socket.onopen = () => {
            setIsConnected(true);
            setErrorMsg(null);
        };

        socket.onclose = () => {
            setIsConnected(false);
        };

        socket.onerror = (err) => {
            socket.close();
        };

        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            
            // 0. Handle Errors
            if (msg.type === 'ERROR') {
                setErrorMsg(msg.payload.message);
                setActiveMarket('STOPPED');
            }

            // 1. Market Lock (Config Update)
            if (msg.type === 'MARKET_LOCKED') {
                setActiveMarket(`${msg.payload.slug}`);
                setErrorMsg(null);
                setNewSlug(msg.payload.slug); // Sync input
                setConfig(prev => ({
                    ...prev,
                    targetMarket: msg.payload.slug
                }));
            }

            // 2. Real-time Price Update
            if (msg.type === 'PRICE_UPDATE') {
                const point: PricePoint = {
                    timestamp: msg.timestamp,
                    sourcePrice: msg.payload.sourcePrice,
                    targetPrice: msg.payload.referencePrice,
                    delta: msg.payload.delta
                };

                setData(prev => {
                    const newData = [...prev, point];
                    if (newData.length > 100) return newData.slice(newData.length - 100);
                    return newData;
                });
            }

            // 3. Trade Execution
            if (msg.type === 'TRADE_EXECUTED') {
                const newTrade: TradeLog = {
                    id: msg.payload.id || 'N/A',
                    timestamp: msg.timestamp,
                    type: msg.payload.type === 'UP' ? 'BUY_UP' : 'BUY_DOWN',
                    asset: msg.payload.asset,
                    entryPrice: msg.payload.price,
                    marketPrice: 0, 
                    amount: msg.payload.amount,
                    status: 'OPEN',
                    profit: 0
                };
                setTrades(prev => [...prev, newTrade]);
            }
        };
    };

    connect();
    
    interval = setInterval(() => {
        if (!ws.current || ws.current.readyState === WebSocket.CLOSED) {
            connect();
        }
    }, 1000);

    return () => {
        clearInterval(interval);
        ws.current?.close();
    };
  }, []);

  const handleUpdateSlug = () => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    if (!newSlug.trim()) return;

    setActiveMarket('Switching...');
    setErrorMsg(null);
    setData([]); // Clear chart
    
    ws.current.send(JSON.stringify({
        type: 'UPDATE_CONFIG',
        payload: { slug: newSlug.trim() }
    }));
  };

  const lastPoint = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div className="h-screen flex flex-col p-4 gap-4 overflow-hidden bg-zinc-950">
      
      {/* Real Mode Banner / Error Banner */}
      {!isConnected && (
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg flex flex-col md:flex-row items-center justify-between gap-4 font-mono shadow-xl animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-red-900/20 rounded-full animate-pulse">
                    <WifiOff size={24} className="text-red-500" />
                </div>
                <div>
                    <h2 className="text-white font-bold text-lg flex items-center gap-2">
                        BOT DISCONNECTED
                    </h2>
                    <p className="text-zinc-500 text-xs mt-1">
                        1. Press <span className="text-emerald-400 font-bold bg-zinc-800 px-1 rounded">Ctrl + C</span> to kill old processes.<br/>
                        2. Verify file exists: <span className="text-zinc-400">ls -l engine.mjs</span><br/>
                        3. Start: <span className="text-emerald-400 font-bold bg-zinc-800 px-1 rounded">node engine.mjs</span>
                    </p>
                </div>
            </div>
            
            <div className="flex items-center gap-4 w-full md:w-auto">
                 <div className="hidden md:block h-8 w-px bg-zinc-800"></div>
                 <div className="flex-1 md:flex-none">
                       <div className="flex items-center gap-2 bg-black/50 p-2 rounded border border-zinc-700 hover:border-emerald-500 transition-colors cursor-pointer group"
                            onClick={() => navigator.clipboard.writeText('cd ~/Desktop/pancho-bot/backend && ls -l && node engine.mjs')}>
                           <code className="text-emerald-400 font-bold text-xs select-all">cd ~/Desktop/pancho-bot/backend && node engine.mjs</code>
                           <Copy size={12} className="text-zinc-600 group-hover:text-emerald-500" />
                       </div>
                 </div>
            </div>
        </div>
      )}
      
      {/* CRITICAL ERROR ALERT */}
      {isConnected && errorMsg && (
         <div className="bg-red-900/20 border border-red-500/50 p-3 rounded-lg flex items-center justify-between gap-4 font-mono animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-3">
                <AlertTriangle className="text-red-500 animate-pulse" size={20} />
                <div>
                    <h3 className="text-red-400 font-bold text-sm">MARKET ERROR</h3>
                    <p className="text-red-200/70 text-xs">{errorMsg}. Please try a valid market slug.</p>
                </div>
            </div>
         </div>
      )}

      {/* Top Bar */}
      <header className={`flex justify-between items-center bg-zinc-900/50 border border-zinc-800 p-4 rounded-lg backdrop-blur-sm transition-opacity duration-500 ${!isConnected ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex items-center gap-3">
           <div className={`w-3 h-3 rounded-full ${isConnected ? (errorMsg ? 'bg-red-500 animate-ping' : 'bg-emerald-500 shadow-[0_0_10px_#10b981]') : 'bg-red-500'}`} />
           <div className="flex flex-col">
             <h1 className="text-xl font-mono font-bold tracking-tight text-white leading-none">PANCHO<span className="text-emerald-500">POLY</span>BOT</h1>
             <span className="text-zinc-500 text-[10px] font-mono tracking-widest mt-0.5">PRODUCTION COMMAND CENTER</span>
           </div>
        </div>
        
        <div className="flex items-center gap-8 text-sm font-mono">
           <div className="flex flex-col items-end opacity-80">
             <span className="text-[10px] text-zinc-500 font-bold tracking-wider">STATUS</span>
             <span className={`font-bold text-xs truncate max-w-[200px] ${errorMsg ? 'text-red-400' : 'text-emerald-400'}`}>
                {activeMarket === 'STOPPED' ? 'IDLE' : 'SCANNING'}
             </span>
           </div>
        </div>
      </header>

      <div className={`flex-1 grid grid-cols-12 gap-4 min-h-0 transition-opacity duration-500 ${!isConnected ? 'opacity-25 pointer-events-none grayscale' : 'opacity-100'}`}>
        
        {/* Left Column: Chart */}
        <div className="col-span-8 flex flex-col gap-4">
          
          {/* Chart Container */}
          <div className="flex-1 bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center mb-4 z-10">
              <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-400">
                <Activity size={16} className="text-emerald-500"/> 
                REAL-TIME DELTA (BINANCE vs REF)
              </h2>
              {lastPoint && (
                <div className="flex items-center gap-6 bg-black/40 px-3 py-1.5 rounded-md border border-zinc-800/50 backdrop-blur-md">
                   <div className="text-xs text-zinc-500 flex flex-col items-end">
                     <span className="text-[10px] uppercase font-bold">Ref Price</span>
                     <span className="text-white font-mono font-bold">${lastPoint.targetPrice.toLocaleString()}</span>
                   </div>
                   <div className="w-px h-6 bg-zinc-800"></div>
                   <div className="text-xs text-zinc-500 flex flex-col items-end">
                     <span className="text-[10px] uppercase font-bold">Live Price</span>
                     <span className="text-emerald-400 font-mono font-bold">${lastPoint.sourcePrice.toLocaleString()}</span>
                   </div>
                   <div className="w-px h-6 bg-zinc-800"></div>
                    <div className="text-xs text-zinc-500 flex flex-col items-end">
                     <span className="text-[10px] uppercase font-bold">Delta</span>
                     <span className={`font-mono font-bold ${Math.abs(lastPoint.delta) > 5 ? 'text-yellow-400 animate-pulse' : 'text-zinc-400'}`}>
                        ${lastPoint.delta.toFixed(2)}
                     </span>
                   </div>
                </div>
              )}
            </div>
            
            <div className="flex-1 w-full min-h-0 relative">
               {!isConnected && (
                   <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/50 backdrop-blur-sm">
                       <div className="text-center">
                           <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mx-auto mb-4" />
                           <p className="text-zinc-400 font-mono">Waiting for Data Stream...</p>
                       </div>
                   </div>
               )}

              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <YAxis domain={['auto', 'auto']} stroke="#52525b" fontSize={12} hide />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', borderRadius: '4px' }}
                    itemStyle={{ fontSize: '12px', fontFamily: 'monospace' }}
                    labelFormatter={() => ''}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
                  />
                  {/* Reference Line (Dynamic based on data) */}
                  {lastPoint && <ReferenceLine y={lastPoint.targetPrice} stroke="#71717a" strokeDasharray="3 3" />}
                  
                  <Line 
                    type="monotone" 
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

          {/* Logs Panel */}
          <div className="h-44 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col overflow-hidden shadow-inner relative">
             <div className="p-3 border-b border-zinc-800 bg-zinc-900/30 flex justify-between items-center z-10">
                <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-400">
                    <Terminal size={16} /> 
                    LIVE EXECUTION LOGS
                </h2>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                    {trades.length} TRADES
                </span>
             </div>
             
             <div className="flex-1 overflow-y-auto p-0 font-mono text-xs z-10">
                <div className="p-3 space-y-1">
                    {trades.length === 0 && (
                        <div className="text-zinc-700 text-center mt-10 italic px-6">
                            <div>No trades executed yet. Watching for opportunities...</div>
                        </div>
                    )}
                    {trades.map((trade, i) => (
                        <div key={i} className="group border-b border-zinc-800/50 pb-2 mb-2 last:border-0 hover:bg-white/5 p-2 rounded transition-colors bg-zinc-900/40">
                             <div className="flex justify-between items-center">
                                <span className={`flex items-center gap-2 font-bold ${trade.type === 'BUY_UP' ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {trade.type === 'BUY_UP' ? <ArrowUpCircle size={14}/> : <ArrowDownCircle size={14}/>}
                                    {trade.type}
                                </span>
                                <span className="text-zinc-400">{trade.id}</span>
                             </div>
                             <div className="text-zinc-500 mt-1">
                                Price: ${trade.entryPrice} | Amount: ${trade.amount}
                             </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>
             </div>
          </div>

        </div>

        {/* Right Column: Status */}
        <div className="col-span-4 flex flex-col gap-4">
             <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 flex flex-col gap-4">
                <h3 className="text-sm font-bold text-zinc-400 flex items-center gap-2">
                    <Settings size={16} />
                    BOT CONFIGURATION
                </h3>
                
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-zinc-600">Active Market Slug</label>
                        <div className="flex gap-2">
                            <input 
                                type="text"
                                value={newSlug}
                                onChange={(e) => setNewSlug(e.target.value)}
                                className="bg-black/50 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-300 w-full focus:outline-none focus:border-emerald-500"
                                placeholder="e.g., bitcoin-dec-31-100k"
                            />
                            <button 
                                onClick={handleUpdateSlug}
                                className="bg-zinc-800 hover:bg-emerald-600 text-white p-1.5 rounded transition-colors"
                            >
                                <RefreshCw size={14} />
                            </button>
                        </div>
                        <p className="text-[10px] text-zinc-600">Paste a new slug above to hot-swap.</p>
                    </div>

                    <div className="border-t border-zinc-800 pt-3">
                        <label className="text-[10px] uppercase font-bold text-zinc-600">Status</label>
                        <div className={`text-sm font-mono font-bold ${isConnected ? (errorMsg ? 'text-red-500' : 'text-emerald-400') : 'text-red-400'}`}>
                            {isConnected ? (errorMsg ? 'ERROR' : 'RUNNING') : 'OFFLINE'}
                        </div>
                    </div>
                </div>
             </div>

             <div className="flex-1 bg-black border border-zinc-800 rounded-lg p-6 relative overflow-hidden flex items-center justify-center">
                 <div className="text-center space-y-4 opacity-50">
                    {errorMsg ? (
                        <XCircle size={48} className="mx-auto text-red-700" />
                    ) : (
                        <TrendingUp size={48} className="mx-auto text-zinc-700" />
                    )}
                    
                    <p className="text-zinc-500 text-sm max-w-[200px] mx-auto">
                        {errorMsg ? "Check market slug above." : "Monitoring price spread for arbitrage opportunities."}
                    </p>
                 </div>
             </div>
        </div>

      </div>
    </div>
  );
};