import React, { useState, useEffect } from 'react';
import { 
  Activity, Power, Server, Shield, Plus, Trash2, 
  Settings, Database, Cloud, AlertTriangle, RefreshCw, 
  Terminal, Lock, PlayCircle, StopCircle, Search, WifiOff,
  ToggleLeft, ToggleRight, AlertCircle
} from 'lucide-react';
import { MarketWithState, BotState, MarketStatusRow } from '../types';
import { supabase } from '../services/supabaseClient';

export const Dashboard: React.FC = () => {
  // State
  const [markets, setMarkets] = useState<MarketWithState[]>([]);
  const [botState, setBotState] = useState<BotState>({
    status: 'STOPPED',
    lastHeartbeat: 0,
    activeMarkets: 0,
    totalExposure: 0,
    globalKillSwitch: false,
    logs: []
  });

  const [newMarketInput, setNewMarketInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [configError, setConfigError] = useState(false);

  // 1. Initial Fetch & Poll Loop
  useEffect(() => {
    fetchData(); // Initial load

    const interval = setInterval(() => {
      fetchData();
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      // A. Check Credentials (Case insensitive check for placeholder)
      const currentUrl = (supabase as any).supabaseUrl || '';
      if (currentUrl.toLowerCase().includes('insert')) {
        setConfigError(true);
        return;
      }

      // B. Fetch Markets Config
      const { data: marketsData, error: marketsError } = await supabase
        .from('markets')
        .select('*')
        .order('created_at', { ascending: true });
      
      if (marketsError) throw marketsError;

      // C. Fetch Live Market State (Read-Only)
      const { data: stateData, error: stateError } = await supabase
        .from('market_state')
        .select('*');

      // Merge Config + State
      const mergedMarkets: MarketWithState[] = (marketsData || []).map(m => {
        const liveState = stateData?.find(s => s.market_id === m.id);
        return { ...m, liveState };
      });
      
      setMarkets(mergedMarkets);

      // D. Fetch Bot Control & Status
      const { data: controlData } = await supabase
        .from('bot_control')
        .select('*')
        .eq('id', 1)
        .single();

      // E. Fetch Logs (Last 15)
      const { data: logsData } = await supabase
        .from('bot_events')
        .select('message, created_at, level')
        .order('created_at', { ascending: false })
        .limit(15);
      
      const formattedLogs = (logsData || []).map(l => 
        `> [${new Date(l.created_at).toLocaleTimeString()}] ${l.level}: ${l.message}`
      ).reverse();

      // Update Bot State
      setBotState(prev => ({
        ...prev,
        status: controlData?.desired_state === 'running' ? 'RUNNING' : 'STOPPED',
        activeMarkets: mergedMarkets.filter(m => m.enabled).length,
        logs: formattedLogs.length > 0 ? formattedLogs : prev.logs,
        totalExposure: mergedMarkets.reduce((acc, m) => acc + (m.liveState?.exposure || 0), 0)
      }));

      setIsLoading(false);

    } catch (err) {
      console.error("Polling Error:", err);
    }
  };

  // 2. Command Handlers
  const handleStartBot = async () => {
    setIsSyncing(true);
    await supabase.from('bot_control').upsert({ id: 1, desired_state: 'running', updated_at: new Date().toISOString() });
    await supabase.from('bot_events').insert({ level: 'INFO', message: 'CMD: START_BOT received from UI' });
    setIsSyncing(false);
  };

  const handleStopBot = async () => {
    setIsSyncing(true);
    await supabase.from('bot_control').upsert({ id: 1, desired_state: 'stopped', updated_at: new Date().toISOString() });
    await supabase.from('bot_events').insert({ level: 'WARN', message: 'CMD: STOP_BOT received from UI' });
    setIsSyncing(false);
  };

  const handleToggleMarket = async (market: MarketWithState) => {
    setIsSyncing(true);
    const newState = !market.enabled;
    
    const { error } = await supabase
      .from('markets')
      .update({ enabled: newState })
      .eq('id', market.id);

    if (error) {
      alert("Failed to update market: " + error.message);
    } else {
      await supabase.from('bot_events').insert({ 
        level: 'INFO', 
        message: `CMD: ${newState ? 'ENABLE' : 'DISABLE'} market ${market.polymarket_market_id}` 
      });
      fetchData();
    }
    setIsSyncing(false);
  };

  const handleAddMarket = async () => {
    if (!newMarketInput.trim()) return;
    
    // Enforcement: Max 5 Markets
    if (markets.length >= 5) {
      alert("LIMIT REACHED: Maximum 5 markets allowed in this version.");
      return;
    }

    setIsSyncing(true);
    
    // Insert new market
    const { error } = await supabase.from('markets').insert({
      polymarket_market_id: newMarketInput,
      asset: 'UNK', // VPS will resolve this later
      direction: 'UP',
      enabled: true,
      max_exposure: 50,
      min_price_delta: 5.0,
      max_entry_price: 0.95
    });

    if (!error) {
      await supabase.from('bot_events').insert({ level: 'INFO', message: `CMD: ADD_MARKET ${newMarketInput}` });
      setNewMarketInput('');
      setShowAddModal(false);
      fetchData(); // Immediate refresh
    } else {
      alert("Error adding market: " + error.message);
    }
    
    setIsSyncing(false);
  };

  const handleRemoveMarket = async (id: string) => {
    if (!confirm('Are you sure? This will remove the market from the bot configuration.')) return;
    
    await supabase.from('markets').delete().eq('id', id);
    await supabase.from('bot_events').insert({ level: 'WARN', message: `CMD: REMOVE_MARKET ${id}` });
    fetchData();
  };

  // Render Loading / Error States
  if (configError) {
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-950 p-6">
        <div className="bg-red-900/20 border border-red-800 p-8 rounded-lg max-w-lg text-center">
          <WifiOff size={48} className="mx-auto text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Connection Required</h2>
          <p className="text-red-200 mb-6">
            Please update <code>services/supabaseClient.ts</code> with your actual Supabase URL and API Key.
          </p>
          <div className="bg-black/50 p-4 rounded text-left font-mono text-xs text-zinc-500 break-all">
            src/services/supabaseClient.ts
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      
      {/* HEADER */}
      <header className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Status Card */}
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

        {/* Database Connection */}
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg flex items-center gap-4">
           <div className={`p-3 rounded-full ${!configError ? 'bg-blue-500/20' : 'bg-red-500/20'}`}>
              <Database className={!configError ? 'text-blue-500' : 'text-red-500'} />
           </div>
           <div>
             <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Database</h2>
             <p className="font-mono text-xl font-bold text-white">
               {isLoading ? 'CONNECTING...' : 'CONNECTED'}
             </p>
           </div>
        </div>

        {/* Exposure */}
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg flex items-center gap-4">
           <div className="p-3 rounded-full bg-yellow-500/20">
              <Shield className="text-yellow-500" />
           </div>
           <div>
             <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Total Exposure</h2>
             <p className="font-mono text-xl font-bold text-white">
               ${botState.totalExposure.toFixed(2)}
             </p>
           </div>
        </div>

        {/* Master Control */}
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg flex items-center justify-between">
           <div>
             <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Command</h2>
             <p className="text-xs text-zinc-400 mt-1">
               {isSyncing ? 'Syncing...' : 'Ready'}
             </p>
           </div>
           {botState.status === 'RUNNING' ? (
             <button disabled={isSyncing} onClick={handleStopBot} className="bg-red-900/50 hover:bg-red-900 text-red-400 border border-red-800 p-3 rounded-full transition-all disabled:opacity-50 group">
                <StopCircle size={24} className="group-hover:scale-110 transition-transform" />
             </button>
           ) : (
             <button disabled={isSyncing} onClick={handleStartBot} className="bg-emerald-900/50 hover:bg-emerald-900 text-emerald-400 border border-emerald-800 p-3 rounded-full transition-all disabled:opacity-50 group">
                <PlayCircle size={24} className="group-hover:scale-110 transition-transform" />
             </button>
           )}
        </div>
      </header>

      {/* MAIN GRID */}
      <div className="grid grid-cols-12 gap-6">
        
        {/* MARKET LIST */}
        <div className="col-span-8 space-y-4">
           <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-zinc-300 flex items-center gap-2">
                 <Cloud size={18} /> Market Configuration
              </h3>
              <button 
                onClick={() => setShowAddModal(true)}
                disabled={markets.length >= 5}
                className="bg-zinc-800 hover:bg-zinc-700 text-white text-xs px-3 py-2 rounded flex items-center gap-2 transition-colors border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={14} /> ADD MARKET ({markets.length}/5)
              </button>
           </div>

           <div className="space-y-3">
              {markets.map(market => (
                <div key={market.id} className={`bg-zinc-900 border rounded-lg p-4 flex flex-col gap-4 group transition-all ${market.enabled ? 'border-zinc-800 hover:border-zinc-700' : 'border-zinc-800 opacity-60'}`}>
                   <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                         {/* Toggle Switch */}
                         <button 
                           onClick={() => handleToggleMarket(market)}
                           className={`transition-colors ${market.enabled ? 'text-emerald-500 hover:text-emerald-400' : 'text-zinc-600 hover:text-zinc-500'}`}
                         >
                            {market.enabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                         </button>
                         
                         <div className="overflow-hidden">
                            <h4 className="font-mono font-bold text-emerald-400 text-sm truncate max-w-[350px]" title={market.polymarket_market_id}>
                              {market.polymarket_market_id}
                            </h4>
                            <div className="flex items-center gap-3 mt-1">
                                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700 font-mono">
                                  {market.enabled ? 'ACTIVE' : 'PAUSED'}
                                </span>
                                <span className="text-[10px] text-zinc-500 font-mono">
                                  ID: {market.id.split('-')[0]}...
                                </span>
                            </div>
                         </div>
                      </div>
                      <div className="flex items-center gap-2">
                         <button onClick={() => handleRemoveMarket(market.id)} className="p-2 hover:bg-red-900/30 rounded text-red-500 transition-colors opacity-50 hover:opacity-100"><Trash2 size={16}/></button>
                      </div>
                   </div>
                   
                   {/* Live State & Config */}
                   <div className="grid grid-cols-4 gap-4 border-t border-zinc-800/50 pt-3">
                      <div>
                        <label className="text-[10px] uppercase text-zinc-600 font-bold block">Live Status</label>
                        <span className={`font-mono text-sm ${market.liveState?.status === 'LOCKED' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                           {market.liveState?.status || 'PENDING'}
                        </span>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase text-zinc-600 font-bold block">Exposure</label>
                        <span className="font-mono text-sm text-zinc-300">
                           ${market.liveState?.exposure || 0} / {market.max_exposure}
                        </span>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase text-zinc-600 font-bold block">Confidence</label>
                        <span className="font-mono text-sm text-zinc-300">
                           {market.liveState?.confidence ? (market.liveState.confidence * 100).toFixed(0) : 0}%
                        </span>
                      </div>
                      <div>
                         <label className="text-[10px] uppercase text-zinc-600 font-bold block">Update</label>
                         <span className="font-mono text-sm text-zinc-500">
                            {market.liveState?.last_update ? new Date(market.liveState.last_update).toLocaleTimeString() : '-'}
                         </span>
                      </div>
                   </div>
                </div>
              ))}
              
              {markets.length === 0 && !isLoading && (
                <div className="text-center py-12 border-2 border-dashed border-zinc-800 rounded-lg">
                  <p className="text-zinc-600 text-sm">No markets configured in database.</p>
                </div>
              )}
           </div>
        </div>

        {/* LOGS */}
        <div className="col-span-4 space-y-4">
           <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 h-[600px] flex flex-col">
              <div className="flex items-center justify-between mb-4 border-b border-zinc-900 pb-2">
                 <h3 className="text-xs font-bold text-zinc-400 flex items-center gap-2">
                    <Terminal size={14} /> LIVE EVENTS
                 </h3>
                 {isSyncing && <RefreshCw size={12} className="text-blue-500 animate-spin" />}
              </div>
              
              <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-1.5 text-zinc-500 pr-2">
                 {botState.logs.length === 0 ? (
                    <span className="opacity-30">Waiting for events...</span>
                 ) : (
                    botState.logs.map((log, i) => (
                      <div key={i} className={`break-words border-l-2 pl-2 ${
                        log.includes('INFO') ? 'border-blue-500/30' : 
                        log.includes('WARN') ? 'border-yellow-500/30 text-yellow-500/80' : 
                        log.includes('ERROR') ? 'border-red-500/50 text-red-500' : 'border-zinc-800'
                      }`}>
                        {log}
                      </div>
                    ))
                 )}
                 <div className="animate-pulse text-emerald-500/50">_</div>
              </div>
           </div>
        </div>
      </div>

      {/* ADD MARKET MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
           <div className="bg-zinc-900 border border-zinc-700 p-6 rounded-lg w-full max-w-md shadow-2xl">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Plus size={20} className="text-emerald-500"/> Add New Market
              </h3>
              
              <div className="bg-yellow-900/20 border border-yellow-700/50 p-3 rounded mb-4 flex gap-2">
                <AlertCircle className="text-yellow-500 shrink-0" size={16} />
                <p className="text-xs text-yellow-200/80">
                  Ensure you paste the correct Polymarket Slug. The bot will auto-resolve the ID later.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Polymarket Slug / ID</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-zinc-500" size={16} />
                    <input 
                      autoFocus
                      type="text" 
                      value={newMarketInput}
                      onChange={(e) => setNewMarketInput(e.target.value)}
                      placeholder="e.g. btc-price-jan-2026"
                      className="w-full bg-black border border-zinc-700 rounded p-2 pl-10 text-sm text-white focus:border-emerald-500 outline-none placeholder:text-zinc-700"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-2 rounded text-xs font-bold transition-colors"
                  >
                    CANCEL
                  </button>
                  <button 
                    onClick={handleAddMarket}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    {isSyncing ? <RefreshCw className="animate-spin" size={14} /> : 'CONFIRM'}
                  </button>
                </div>
              </div>
           </div>
        </div>
      )}

    </div>
  );
};
