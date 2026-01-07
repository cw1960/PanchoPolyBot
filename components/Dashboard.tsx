import React, { useState, useEffect, useRef } from 'react';
import { BotConfig, PricePoint, TradeLog } from '../types';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { Play, Pause, Activity, TrendingUp, DollarSign, Terminal, Settings, Search, Check, Loader2, Network, ArrowUpCircle, ArrowDownCircle, Info, Wifi, WifiOff, Copy, FolderSearch, RefreshCw, AlertTriangle, XCircle, ArrowRight, Save, Link, Edit2, RotateCcw } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [activeMarket, setActiveMarket] = useState<string>('Scanning Markets...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Configuration State
  const [newSlug, setNewSlug] = useState('');
  const [betSize, setBetSize] = useState('10');
  const [maxEntry, setMaxEntry] = useState('0.95');
  const [minDelta, setMinDelta] = useState('5.0');
  const [refPrice, setRefPrice] = useState(''); 
  const [isUpdating, setIsUpdating] = useState(false); 
  const [shake, setShake] = useState(false); // Visual error feedback
  
  const [data, setData] = useState<PricePoint[]>([]);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [systemLogs, setSystemLogs] = useState<string[]>([]); 

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trades, systemLogs]);

  const connect = () => {
    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        return;
    }

    const socket = new WebSocket('ws://localhost:8080');
    ws.current = socket;

    socket.onopen = () => {
        setIsConnected(true);
        setErrorMsg(null);
        setSystemLogs(prev => [...prev, `> [SYSTEM] Connected to Local Bot v8.0`]);
        if (isUpdating) {
            // If we were trying to update, resend now
            handleUpdateConfig();
        }
    };

    socket.onclose = () => {
        setIsConnected(false);
        setIsUpdating(false);
    };

    socket.onerror = (err) => {
        socket.close();
    };

    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        // LOG Handling
        if (msg.type === 'LOG') {
            setSystemLogs(prev => [...prev, `> [BOT] ${msg.payload.message}`]);
        }

        // SEARCH_COMPLETE Handling
        if (msg.type === 'SEARCH_COMPLETE') {
            setIsUpdating(false);
            if (msg.payload.found === 0) {
                setErrorMsg("No markets found with that ID.");
                setSystemLogs(prev => [...prev, `> [ERROR] Search finished. No markets found.`]);
            }
        }

        if (['ERROR', 'MARKET_LOCKED'].includes(msg.type)) {
           setIsUpdating(false);
        }

        if (msg.type === 'ERROR') {
            setErrorMsg(msg.payload.message);
            setActiveMarket('STOPPED');
            setSystemLogs(prev => [...prev, `> [ERROR] ${msg.payload.message}`]);
        }

        if (msg.type === 'MARKET_LOCKED') {
            setActiveMarket(`${msg.payload.slug}`);
            setErrorMsg(null);
            setNewSlug(msg.payload.slug); 
            
            if (msg.payload.referencePrice) {
                setRefPrice(msg.payload.referencePrice.toString());
            }
            
            setSystemLogs(prev => [...prev, `> [SUCCESS] Market Locked: ${msg.payload.slug}`]);
        }
        
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
            setSystemLogs(prev => [...prev, `> [TRADE] Executed ${newTrade.type} @ $${newTrade.entryPrice}`]);
        }
    };
  };

  // --- REAL WEBSOCKET CONNECTION ---
  useEffect(() => {
    connect();
    const interval = setInterval(() => {
        if (!ws.current || ws.current.readyState === WebSocket.CLOSED) {
            connect();
        }
    }, 2000); // Check every 2s

    return () => {
        clearInterval(interval);
        ws.current?.close();
    };
  }, []);

  const triggerShake = () => {
      setShake(true);
      setTimeout(() => setShake(false), 500);
  }

  const handleUpdateConfig = () => {
    const rawSlug = newSlug.trim();
    if (!rawSlug) {
        setSystemLogs(prev => [...prev, `> [WARN] Update ignored: Input empty.`]);
        return;
    }

    // Always set updating to true for visual feedback
    setIsUpdating(true);
    setActiveMarket('Updating...');
    
    // Check connection
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        setSystemLogs(prev => [...prev, `> [WARN] Bot Disconnected. Attempting reconnect...`]);
        connect(); 
        
        // If still closed after immediate connect attempt (async), fail after delay
        setTimeout(() => {
            if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
                setSystemLogs(prev => [...prev, `> [ERROR] Update Failed: Backend Dead.`]);
                setErrorMsg("Connection Lost. Check Terminal.");
                setIsUpdating(false);
                triggerShake();
            }
        }, 1000);
        return;
    }

    setErrorMsg(null);
    if (rawSlug !== activeMarket) setData([]); 
    
    setSystemLogs(prev => [...prev, `> [CMD] Sending Update: ${rawSlug}`]);
    
    try {
        ws.current.send(JSON.stringify({
            type: 'UPDATE_CONFIG',
            payload: { 
                slug: rawSlug,
                betSize: parseFloat(betSize),
                maxEntryPrice: parseFloat(maxEntry),
                minPriceDelta: parseFloat(minDelta),
                referencePrice: parseFloat(refPrice)
            }
        }));
    } catch (e) {
        setSystemLogs(prev => [...prev, `> [ERROR] Send Failed.`]);
        setIsUpdating(false);
        triggerShake();
    }
  };

  const lastPoint = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div className="h-screen flex flex-col p-4 gap-4 overflow-hidden bg-zinc-950">
      
      {/* Real Mode Banner / Error Banner */}
      {!isConnected && (
        <div className="bg-red-950/30 border border-red-900/50 p-3 rounded-lg flex flex-col md:flex-row items-center justify-between gap-4 font-mono shadow-xl animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="flex items-center gap-4">
                <div className="p-2 bg-red-900/20 rounded-full animate-pulse">
                    <WifiOff size={20} className="text-red-500" />
                </div>
                <div>
                    <h2 className="text-red-400 font-bold text-sm flex items-center gap-2">
                        BACKEND DISCONNECTED
                    </h2>
                    <p className="text-zinc-500 text-[10px] mt-0.5">
                        The UI cannot talk to the trading bot. Is `node bot.mjs` running?
                    </p>
                </div>
            </div>
            <button 
                onClick={connect}
                className="bg-red-900/20 hover:bg-red-900/40 text-red-400 text-xs px-3 py-1.5 rounded border border-red-900/50 flex items-center gap-2 transition-colors"
            >
                <RefreshCw size={12} /> RETRY CONNECTION
            </button>
        </div>
      )}

      {/* Top Bar */}
      <header className={`flex justify-between items-center bg-zinc-900/50 border border-zinc-800 p-4 rounded-lg backdrop-blur-sm transition-opacity duration-500 ${!isConnected ? 'opacity-80' : 'opacity-100'}`}>
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
             <span className={`font-bold text-xs truncate max-w-[200px] ${activeMarket === 'STOPPED' || errorMsg ? 'text-red-400' : (activeMarket === 'Updating...' ? 'text-yellow-400' : 'text-emerald-400')}`}>
                {activeMarket === 'STOPPED' ? (errorMsg ? 'ERROR' : 'IDLE') : activeMarket === 'Scanning Markets...' ? 'INITIALIZING' : activeMarket === 'Updating...' ? 'SEARCHING...' : 'RUNNING'}
             </span>
           </div>
        </div>
      </header>

      <div className={`flex-1 grid grid-cols-12 gap-4 min-h-0 transition-opacity duration-500 ${!isConnected ? 'opacity-50 grayscale' : 'opacity-100'}`}>
        
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
                           <WifiOff className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
                           <p className="text-zinc-500 font-mono">Stream Disconnected</p>
                       </div>
                   </div>
               )}
               
               {/* OVERLAY: ERROR or IDLE */}
               {isConnected && (activeMarket === 'STOPPED' || activeMarket === 'Scanning Markets...') && (
                   <div className={`absolute inset-0 flex items-center justify-center z-20 bg-black/80 backdrop-blur-md transition-transform duration-100 ${shake ? 'translate-x-2' : ''} ${shake ? '-translate-x-2' : ''}`}>
                       <div className={`text-center p-8 border ${errorMsg ? 'border-red-900 bg-red-950/20' : 'border-zinc-800 bg-zinc-950'} rounded-lg shadow-2xl transition-all duration-300`}>
                           {errorMsg ? (
                               <>
                                   <div className="bg-red-900/20 p-4 rounded-full w-fit mx-auto mb-4 animate-bounce">
                                     <XCircle className="w-8 h-8 text-red-500" />
                                   </div>
                                   <h3 className="text-xl font-bold text-red-500 mb-2">Configuration Error</h3>
                                   <p className="text-red-200 text-sm mb-2 max-w-md mx-auto font-mono">
                                       {errorMsg}
                                   </p>
                                   <p className="text-zinc-500 text-xs">Try a different Market ID or Slug.</p>
                               </>
                           ) : (
                               <>
                                   <div className="bg-yellow-900/20 p-4 rounded-full w-fit mx-auto mb-4">
                                     <Link className="w-8 h-8 text-yellow-500 animate-pulse" />
                                   </div>
                                   <h3 className="text-xl font-bold text-white mb-2">System Idle</h3>
                                   <p className="text-zinc-400 text-sm mb-6 max-w-md mx-auto">
                                       Enter a <span className="text-emerald-400 font-mono">Market ID</span> (e.g. 123456...) in the configuration panel.
                                   </p>
                               </>
                           )}
                       </div>
                   </div>
               )}

               {isUpdating && (
                   <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/90 backdrop-blur-md">
                       <div className="text-center p-8">
                           <Loader2 className="w-12 h-12 text-yellow-500 animate-spin mx-auto mb-4" />
                           <h3 className="text-xl font-bold text-white mb-2">Resolving Market...</h3>
                           <p className="text-zinc-400 text-sm font-mono">
                               Querying Polymarket API for: <span className="text-emerald-400">{newSlug}</span>
                           </p>
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
                  {lastPoint && <ReferenceLine y={lastPoint.targetPrice} stroke="#71717a" strokeDasharray="3 3" />}
                  <Line type="monotone" dataKey="sourcePrice" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Logs Panel */}
          <div className="h-44 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col overflow-hidden shadow-inner relative">
             <div className="p-3 border-b border-zinc-800 bg-zinc-900/30 flex justify-between items-center z-10">
                <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-400">
                    <Terminal size={16} /> 
                    SYSTEM LOGS & TRADES
                </h2>
             </div>
             
             <div className="flex-1 overflow-y-auto p-0 font-mono text-xs z-10">
                <div className="p-3 space-y-1">
                    {/* Render Mixed Logs */}
                    {systemLogs.length === 0 && trades.length === 0 && (
                         <div className="text-zinc-700 text-center mt-10 italic px-6">
                            <div>Waiting for commands...</div>
                        </div>
                    )}
                    
                    {systemLogs.map((log, i) => (
                        <div key={`sys-${i}`} className={`border-b border-zinc-800/20 pb-1 mb-1 ${log.includes('ERROR') ? 'text-red-400' : 'text-zinc-500'}`}>
                            {log}
                        </div>
                    ))}
                    
                    {trades.map((trade, i) => (
                        <div key={`trade-${i}`} className="group border-b border-zinc-800/50 pb-2 mb-2 last:border-0 hover:bg-white/5 p-2 rounded transition-colors bg-zinc-900/40">
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
                    {/* Ref Price Override */}
                    <div className="space-y-1 bg-yellow-900/10 border border-yellow-700/30 p-2 rounded">
                        <div className="flex items-center justify-between">
                            <label className="text-[9px] uppercase font-bold text-yellow-500 flex items-center gap-1">
                                <Edit2 size={10} /> Ref Price Override
                            </label>
                        </div>
                        <input 
                            type="number" 
                            value={refPrice} 
                            onChange={(e) => setRefPrice(e.target.value)} 
                            placeholder="Current Ref Price"
                            className="bg-black/50 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-white w-full focus:outline-none focus:border-yellow-500" 
                        />
                        <div className="text-[9px] text-zinc-500 leading-tight">
                            Use this to fix discrepancies between Binance and Polymarket's "Price to Beat".
                        </div>
                    </div>

                    {/* Strategy Parameters */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                            <label className="text-[9px] uppercase font-bold text-zinc-600">Bet Size ($)</label>
                            <input 
                                type="number" 
                                value={betSize} 
                                onChange={(e) => setBetSize(e.target.value)} 
                                className="bg-black/50 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-emerald-300 w-full focus:outline-none focus:border-emerald-500" 
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] uppercase font-bold text-zinc-600">Max Entry ($)</label>
                            <input 
                                type="number" 
                                value={maxEntry} 
                                onChange={(e) => setMaxEntry(e.target.value)} 
                                className="bg-black/50 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-yellow-300 w-full focus:outline-none focus:border-emerald-500" 
                            />
                        </div>
                         <div className="space-y-1">
                            <label className="text-[9px] uppercase font-bold text-zinc-600">Min Delta ($)</label>
                            <input 
                                type="number" 
                                value={minDelta} 
                                onChange={(e) => setMinDelta(e.target.value)} 
                                className="bg-black/50 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-blue-300 w-full focus:outline-none focus:border-emerald-500" 
                            />
                        </div>
                    </div>

                    {/* Slug Input */}
                    <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-zinc-600">Active Market Slug OR Market ID</label>
                        <textarea 
                            value={newSlug}
                            onChange={(e) => setNewSlug(e.target.value)}
                            className="bg-black/50 border border-zinc-700 rounded px-2 py-2 text-xs font-mono text-zinc-300 w-full h-16 resize-none focus:outline-none focus:border-emerald-500 leading-tight"
                            placeholder="e.g. 1767803541594 (Recommended) OR bitcoin-slug..."
                        />
                    </div>
                    
                    {/* Apply Button */}
                    <button 
                        onClick={handleUpdateConfig}
                        disabled={isUpdating}
                        className={`w-full text-white p-2 rounded transition-colors flex items-center justify-center gap-2 text-xs font-bold tracking-wider ${isUpdating ? 'bg-zinc-700 cursor-not-allowed' : (isConnected ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-900 hover:bg-red-800')}`}
                    >
                        {isUpdating ? <Loader2 size={14} className="animate-spin" /> : (!isConnected ? <RefreshCw size={14} /> : <Save size={14} />)}
                        {isUpdating ? 'SEARCHING...' : (!isConnected ? 'RECONNECT & UPDATE' : 'UPDATE CONFIGURATION')}
                    </button>

                    <div className="border-t border-zinc-800 pt-3 flex justify-between items-center">
                        <label className="text-[10px] uppercase font-bold text-zinc-600">Connection Status</label>
                        <div className={`text-sm font-mono font-bold ${isConnected ? (errorMsg ? 'text-red-500' : 'text-emerald-400') : 'text-red-400'}`}>
                            {isConnected ? (errorMsg ? 'ERROR' : 'RUNNING') : 'OFFLINE'}
                        </div>
                    </div>
                </div>
             </div>
             
             {/* Status Box */}
             <div className="flex-1 bg-black border border-zinc-800 rounded-lg p-6 relative overflow-hidden flex items-center justify-center">
                 <div className={`text-center space-y-4 opacity-50 transition-transform ${shake ? 'translate-x-1' : ''}`}>
                    {errorMsg ? (
                        <XCircle size={48} className="mx-auto text-red-700" />
                    ) : (
                        <TrendingUp size={48} className="mx-auto text-zinc-700" />
                    )}
                    
                    <p className="text-zinc-500 text-sm max-w-[200px] mx-auto">
                        {errorMsg ? "Bot failed to lock market." : "Monitoring price spread for arbitrage opportunities."}
                    </p>
                 </div>
             </div>
        </div>

      </div>
    </div>
  );
};