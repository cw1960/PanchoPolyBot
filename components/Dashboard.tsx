import React, { useState, useEffect } from 'react';
import { 
  Activity, Power, Server, Shield, Plus, Trash2, 
  Settings, Database, Cloud, AlertTriangle, RefreshCw, 
  Terminal, Lock, PlayCircle, StopCircle, Search, WifiOff
} from 'lucide-react';
import { MarketConfig, BotState, BotStatus } from '../types';
import { supabase } from '../services/supabaseClient';

export const Dashboard: React.FC = () => {
  // State
  const [markets, setMarkets] = useState<MarketConfig[]>([]);
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
      // A. Check Credentials
      if ((supabase as any).supabaseUrl.includes('INSERT')) {
        setConfigError(true);
        return;
      }

      // B. Fetch Markets
      const { data: marketsData, error: marketsError } = await supabase
        .from('markets')
        .select('*')
        .order('created_at', { ascending: true });
      
      if (marketsError) throw marketsError;
      setMarkets(marketsData || []);

      // C. Fetch Bot Control & Status
      const { data: controlData } = await supabase
        .from('bot_control')
        .select('*')
        .eq('id', 1)
        .single();

      // D. Fetch Logs (Last 10)
      const { data: logsData } = await supabase
        .from('bot_events')
        .select('message, created_at, level')
        .order('created_at', { ascending: false })
        .limit(10);
      
      const formattedLogs = (logsData || []).map(l => 
        `> [${new Date(l.created_at).toLocaleTimeString()}] ${l.level}: ${l.message}`
      ).reverse();

      // Update State
      setBotState(prev => ({
        ...prev,
        status: controlData?.desired_state === 'running' ? 'RUNNING' : 'STOPPED',
        activeMarkets: marketsData?.filter(m => m.enabled).length || 0,
        logs: formattedLogs.length > 0 ? formattedLogs : prev.logs,
        // Calculate mock exposure for now, or fetch from market_state if populated
        totalExposure: marketsData?.reduce((acc, m) => acc + (m.enabled ? 0 : 0), 0) || 0
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

  const handleAddMarket = async () => {
    if (!newMarketInput.trim()) return;
    setIsSyncing(true);
    
    // Insert new market
    const { error } = await supabase.from('markets').insert({
      polymarket_market_id: newMarketInput,
      asset: 'UNK', // VPS will resolve this later
      direction: 'UP',
      enabled: true,
      max_exposure: 50
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
          <div className="bg-black/50 p-4 rounded text-left font-mono text-xs text-zinc-500">
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
             <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Active Markets</h2>
             <p className="font-mono text-xl font-bold text-white">
               {botState.activeMarkets}
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
             <button disabled={isSyncing} onClick={handleStopBot} className="bg-red-900/50 hover:bg-red-900 text-red-400 border border-red-800 p-3 rounded-full transition-all disabled:opacity-50">
                <StopCircle size={24} />
             </button>
           ) : (
             <button disabled={isSyncing} onClick={handleStartBot} className="bg-emerald-900/50 hover:bg-emerald-900 text-emerald-400 border border-emerald-800 p-3 rounded-full transition-all disabled:opacity-50">
                <PlayCircle size={24} />
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
                            <p className="text-xs text-zinc-500">UUID: {market.id}</p>
                         </div>
                      </div>
                      <div className="flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                         <button onClick={() => handleRemoveMarket(market.id)} className="p-2 hover:bg-red-900/30 rounded text-red-500"><Trash2 size={14}/></button>
                      </div>
                   </div>
                   
                   <div className="grid grid-cols-3 gap-4 border-t border-zinc-800/50 pt-3">
                      <div>
                        <label className="text-[10px] uppercase text-zinc-600 font-bold block">Max Risk</label>
                        <span className="font-mono text-sm text-zinc-300">${market.max_exposure}</span>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase text-zinc-600 font-bold block">Status</label>
                        <span className="font-mono text-sm text-zinc-300">{market.enabled ? 'ENABLED' : 'DISABLED'}</span>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase text-zinc-600 font-bold block">Last Update</label>
                        <span className="font-mono text-sm text-zinc-300">{market.created_at ? new Date(market.created_at).toLocaleDateString() : '-'}</span>
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
           <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 h-[500px] flex flex-col">
              <div className="flex items-center justify-between mb-4 border-b border-zinc-900 pb-2">
                 <h3 className="text-xs font-bold text-zinc-400 flex items-center gap-2">
                    <Terminal size={14} /> LIVE LOGS
                 </h3>
                 {isSyncing && <RefreshCw size={12} className="text-blue-500 animate-spin" />}
              </div>
              
              <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-1 text-zinc-500">
                 {botState.logs.length === 0 ? (
                    <span className="opacity-30">Waiting for events...</span>
                 ) : (
                    botState.logs.map((log, i) => (
                      <div key={i} className={`break-words ${log.includes('CMD') ? 'text-yellow-500/80' : 'text-zinc-500'}`}>
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
           <div className="bg-zinc-900 border border-zinc-700 p-6 rounded-lg w-full max-w-md shadow-2xl">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Plus size={20} className="text-emerald-500"/> Add New Market
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Polymarket Slug</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-zinc-500" size={16} />
                    <input 
                      autoFocus
                      type="text" 
                      value={newMarketInput}
                      onChange={(e) => setNewMarketInput(e.target.value)}
                      placeholder="e.g. btc-price-jan-2026"
                      className="w-full bg-black border border-zinc-700 rounded p-2 pl-10 text-sm text-white focus:border-emerald-500 outline-none"
                    />
                  </div>
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
