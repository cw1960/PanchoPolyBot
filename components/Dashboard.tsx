
import React, { useState, useEffect } from 'react';
import { 
  Activity, Power, Server, Shield, Plus, Trash2, 
  Settings, Database, Cloud, AlertTriangle, RefreshCw, 
  Terminal, Lock, PlayCircle, StopCircle, Search
} from 'lucide-react';
import { MarketConfig, BotState, BotStatus } from '../types';

// --- MOCK SUPABASE LAYER ---
// In a real app, these would be API calls to Supabase
const mockInitialMarkets: MarketConfig[] = [
  { 
    id: '1', 
    polymarket_market_id: 'btc-jan-2026-100k', 
    asset: 'BTC',
    direction: 'UP',
    enabled: true, 
    max_exposure: 100, 
    min_price_delta: 5.0, 
    max_entry_price: 0.95 
  },
];

export const Dashboard: React.FC = () => {
  // Local State representing "Cloud" State
  const [markets, setMarkets] = useState<MarketConfig[]>(mockInitialMarkets);
  const [botState, setBotState] = useState<BotState>({
    status: 'STOPPED',
    lastHeartbeat: Date.now() - 15000, // Stale heartbeat initially
    activeMarkets: 0,
    totalExposure: 0,
    globalKillSwitch: false,
    logs: ['> SYSTEM: Initializing Control Plane...', '> AUTH: Anonymous Session Started.']
  });

  // UI State
  const [newMarketInput, setNewMarketInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Simulate periodic "Fetch from Supabase"
  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate Bot Heartbeat updates if "Running"
      if (botState.status === 'RUNNING') {
        setBotState(prev => ({
          ...prev,
          lastHeartbeat: Date.now(),
          logs: Math.random() > 0.7 
            ? [...prev.logs, `> VPS: Monitoring ${markets.length} markets...`] 
            : prev.logs
        }));
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [botState.status, markets.length]);

  // Command Handlers
  const handleStartBot = () => {
    pushLog('> CMD: START_BOT sent to Command Queue.');
    // Optimistic update
    setBotState(prev => ({ ...prev, status: 'STARTING' }));
    
    setTimeout(() => {
      setBotState(prev => ({ ...prev, status: 'RUNNING', lastHeartbeat: Date.now() }));
      pushLog('> VPS: Signal Received. Engine Started.');
    }, 2000);
  };

  const handleStopBot = () => {
    pushLog('> CMD: STOP_BOT sent to Command Queue.');
    setBotState(prev => ({ ...prev, status: 'STOPPED' }));
    pushLog('> VPS: Engine Halted by User.');
  };

  const handleAddMarket = () => {
    if (!newMarketInput.trim()) return;
    
    setIsSyncing(true);
    pushLog(`> CMD: ADD_MARKET "${newMarketInput}"`);
    
    // Simulate API latency
    setTimeout(() => {
      const newMarket: MarketConfig = {
        id: Math.random().toString(36).substr(2, 9),
        polymarket_market_id: newMarketInput,
        asset: 'BTC', // Mock default
        direction: 'UP', // Mock default
        enabled: true,
        max_exposure: 50, // Default safety
        min_price_delta: 5.0,
        max_entry_price: 0.95
      };
      setMarkets(prev => [...prev, newMarket]);
      setNewMarketInput('');
      setShowAddModal(false);
      setIsSyncing(false);
      pushLog('> DB: Configuration updated successfully.');
    }, 800);
  };

  const handleRemoveMarket = (id: string) => {
    if (!confirm('Are you sure? This will force close any open positions on this market.')) return;
    pushLog(`> CMD: REMOVE_MARKET ID:${id}`);
    setMarkets(prev => prev.filter(m => m.id !== id));
  };

  const pushLog = (msg: string) => {
    setBotState(prev => ({
      ...prev,
      logs: [...prev.logs.slice(-50), `${new Date().toLocaleTimeString()} ${msg}`]
    }));
  };

  // Derived Status
  const isHealthy = Date.now() - botState.lastHeartbeat < 10000;
  
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      
      {/* HEADER: GLOBAL STATUS */}
      <header className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg flex items-center gap-4">
           <div className={`p-3 rounded-full ${botState.status === 'RUNNING' ? 'bg-emerald-500/20' : 'bg-zinc-800'}`}>
              <Power className={botState.status === 'RUNNING' ? 'text-emerald-500' : 'text-zinc-500'} />
           </div>
           <div>
             <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Bot Status</h2>
             <p className={`font-mono text-xl font-bold ${botState.status === 'RUNNING' ? 'text-emerald-400' : 'text-zinc-400'}`}>
               {botState.status}
             </p>
           </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg flex items-center gap-4">
           <div className={`p-3 rounded-full ${isHealthy ? 'bg-blue-500/20' : 'bg-red-500/20'}`}>
              <Server className={isHealthy ? 'text-blue-500' : 'text-red-500'} />
           </div>
           <div>
             <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">VPS Heartbeat</h2>
             <p className="font-mono text-xl font-bold text-white">
               {isHealthy ? 'ONLINE' : 'LOST SIGNAL'}
             </p>
           </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg flex items-center gap-4">
           <div className="p-3 rounded-full bg-yellow-500/20">
              <Shield className="text-yellow-500" />
           </div>
           <div>
             <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Global Exposure</h2>
             <p className="font-mono text-xl font-bold text-white">
               ${botState.totalExposure.toFixed(2)}
             </p>
           </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg flex items-center justify-between">
           <div>
             <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Control</h2>
             <p className="text-xs text-zinc-400 mt-1">Global Kill Switch: <span className="text-zinc-500">OFF</span></p>
           </div>
           {botState.status === 'RUNNING' ? (
             <button onClick={handleStopBot} className="bg-red-900/50 hover:bg-red-900 text-red-400 border border-red-800 p-3 rounded-full transition-all">
                <StopCircle size={24} />
             </button>
           ) : (
             <button onClick={handleStartBot} className="bg-emerald-900/50 hover:bg-emerald-900 text-emerald-400 border border-emerald-800 p-3 rounded-full transition-all">
                <PlayCircle size={24} />
             </button>
           )}
        </div>
      </header>

      {/* MAIN CONTENT GRID */}
      <div className="grid grid-cols-12 gap-6">
        
        {/* LEFT: MARKET CONFIGURATION */}
        <div className="col-span-8 space-y-4">
           <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-zinc-300 flex items-center gap-2">
                 <Database size={18} /> Active Markets
                 <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded-full text-zinc-500">{markets.length}</span>
              </h3>
              <button 
                onClick={() => setShowAddModal(true)}
                className="bg-zinc-800 hover:bg-zinc-700 text-white text-xs px-3 py-2 rounded flex items-center gap-2 transition-colors border border-zinc-700"
              >
                <Plus size={14} /> ADD MARKET
              </button>
           </div>

           <div className="space-y-3">
              {markets.map(market => (
                <div key={market.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col gap-4 group hover:border-zinc-700 transition-all">
                   <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                         <div className={`w-2 h-2 rounded-full ${market.enabled ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                         <div>
                            <h4 className="font-mono font-bold text-emerald-400 text-sm truncate max-w-[300px]">{market.polymarket_market_id}</h4>
                            <p className="text-xs text-zinc-500">ID: {market.id}</p>
                         </div>
                      </div>
                      <div className="flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                         <button className="p-2 hover:bg-zinc-800 rounded text-zinc-400"><Settings size={14}/></button>
                         <button onClick={() => handleRemoveMarket(market.id)} className="p-2 hover:bg-red-900/30 rounded text-red-500"><Trash2 size={14}/></button>
                      </div>
                   </div>
                   
                   <div className="grid grid-cols-3 gap-4 border-t border-zinc-800/50 pt-3">
                      <div>
                        <label className="text-[10px] uppercase text-zinc-600 font-bold block">Max Risk</label>
                        <span className="font-mono text-sm text-zinc-300">${market.max_exposure}</span>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase text-zinc-600 font-bold block">Trigger Delta</label>
                        <span className="font-mono text-sm text-zinc-300">{market.min_price_delta}%</span>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase text-zinc-600 font-bold block">Max Entry</label>
                        <span className="font-mono text-sm text-zinc-300">${market.max_entry_price}</span>
                      </div>
                   </div>
                </div>
              ))}
              
              {markets.length === 0 && (
                <div className="text-center py-12 border-2 border-dashed border-zinc-800 rounded-lg">
                  <p className="text-zinc-600 text-sm">No markets configured.</p>
                </div>
              )}
           </div>
        </div>

        {/* RIGHT: SYSTEM LOGS & CLOUD STATUS */}
        <div className="col-span-4 space-y-4">
           <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 h-[500px] flex flex-col">
              <div className="flex items-center justify-between mb-4 border-b border-zinc-900 pb-2">
                 <h3 className="text-xs font-bold text-zinc-400 flex items-center gap-2">
                    <Cloud size={14} /> COMMAND QUEUE (SUPABASE)
                 </h3>
                 {isSyncing && <RefreshCw size={12} className="text-blue-500 animate-spin" />}
              </div>
              
              <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-1 text-zinc-500">
                 {botState.logs.map((log, i) => (
                   <div key={i} className={`break-words ${log.includes('CMD') ? 'text-yellow-500/80' : 'text-zinc-500'}`}>
                     {log}
                   </div>
                 ))}
                 <div className="animate-pulse text-emerald-500/50">_</div>
              </div>
           </div>
           
           <div className="bg-blue-900/10 border border-blue-900/30 p-4 rounded-lg">
              <div className="flex gap-3">
                 <AlertTriangle size={16} className="text-blue-400 shrink-0 mt-1" />
                 <p className="text-xs text-blue-200/70 leading-relaxed">
                   <strong>Architecture Note:</strong> This UI is decoupled from the trading engine. 
                   Changes made here are pushed to the Cloud Database. The VPS Bot polls for these changes every 2 seconds.
                 </p>
              </div>
           </div>
        </div>
      </div>

      {/* MODAL: ADD MARKET */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
           <div className="bg-zinc-900 border border-zinc-700 p-6 rounded-lg w-full max-w-md shadow-2xl">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Plus size={20} className="text-emerald-500"/> Add New Market
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Polymarket Slug or ID</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-zinc-500" size={16} />
                    <input 
                      autoFocus
                      type="text" 
                      value={newMarketInput}
                      onChange={(e) => setNewMarketInput(e.target.value)}
                      placeholder="e.g. bitcoin-price-jan-2026"
                      className="w-full bg-black border border-zinc-700 rounded p-2 pl-10 text-sm text-white focus:border-emerald-500 outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-2">
                    The bot will auto-resolve the Up/Down tokens and Binance reference pair based on this slug.
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-2 rounded text-xs font-bold"
                  >
                    CANCEL
                  </button>
                  <button 
                    onClick={handleAddMarket}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded text-xs font-bold flex items-center justify-center gap-2"
                  >
                    {isSyncing ? <RefreshCw className="animate-spin" size={14} /> : 'CONFIRM & SYNC'}
                  </button>
                </div>
              </div>
           </div>
        </div>
      )}

    </div>
  );
};
