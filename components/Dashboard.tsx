
import React, { useState, useEffect } from 'react';
import { 
  Play, Square, Activity, Shield, 
  Terminal, RefreshCcw, Save,
  Info, LayoutDashboard, LineChart
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { ResultsView } from './ResultsView';

// --- SUPABASE CLIENT ---
const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- TYPES ---
interface ActiveMarket {
    id: string;
    polymarket_market_id: string;
    asset: string;
    t_expiry?: string;
    baseline_price?: number;
}

interface GlobalConfig {
    maxExposure: number;
}

interface BotHeartbeat {
    last_seen: string;
    status: string;
}

interface MarketState {
    confidence: number;
    delta: number;
    exposure: number;
    spot_price_median: number;
    chainlink_price: number;
    status: string;
}

export const Dashboard: React.FC = () => {
  // Navigation State
  const [activeTab, setActiveTab] = useState<'COMMAND' | 'RESULTS'>('COMMAND');

  // Core State
  const [activeMarket, setActiveMarket] = useState<ActiveMarket | null>(null);
  const [marketState, setMarketState] = useState<MarketState | null>(null);
  const [config, setConfig] = useState<GlobalConfig>({ maxExposure: 100 });
  
  const [botStatus, setBotStatus] = useState<'running' | 'stopped'>('stopped');
  const [heartbeat, setHeartbeat] = useState<BotHeartbeat | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastLog, setLastLog] = useState<string>('');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000); // 2s Poll
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
      const { data: ctrl } = await supabase.from('bot_control').select('desired_state').eq('id', 1).single();
      if (ctrl) setBotStatus(ctrl.desired_state);

      const { data: markets } = await supabase.from('markets').select('*').eq('enabled', true);
      if (markets && markets.length > 0) {
          const m = markets[0];
          setActiveMarket(m);
          const { data: state } = await supabase.from('market_state').select('*').eq('market_id', m.id).maybeSingle();
          if (state) setMarketState(state);
      } else {
          setActiveMarket(null);
          setMarketState(null);
      }

      const { data: run } = await supabase.from('test_runs').select('params').eq('name', 'AUTO_TRADER_GLOBAL_CONFIG').maybeSingle();
      if (run && run.params && !isSaving) { 
         const dbExposure = run.params.maxExposure;
         if (dbExposure !== undefined) setConfig({ maxExposure: dbExposure });
      }

      const { data: hb } = await supabase.from('bot_heartbeats').select('*').order('last_seen', {ascending: false}).limit(1).maybeSingle();
      if (hb) setHeartbeat(hb);
      
      const { data: logs } = await supabase.from('trade_events').select('asset, side, status, created_at').order('created_at', {ascending: false}).limit(1).maybeSingle();
      if (logs) setLastLog(`${new Date(logs.created_at).toLocaleTimeString()}: ${logs.status} ${logs.side} on ${logs.asset}`);
  };

  const toggleBot = async () => {
      const newState = botStatus === 'running' ? 'stopped' : 'running';
      await supabase.from('bot_control').update({ desired_state: newState }).eq('id', 1);
      setBotStatus(newState);
  };

  const saveConfig = async () => {
      setIsSaving(true);
      const { error } = await supabase.from('test_runs')
        .update({ params: { maxExposure: config.maxExposure } })
        .eq('name', 'AUTO_TRADER_GLOBAL_CONFIG');
      if (error) alert("Failed to save risk config");
      await supabase.from('bot_control').update({ updated_at: new Date().toISOString() }).eq('id', 1);
      setTimeout(() => setIsSaving(false), 1000);
  };

  const handleManualRotation = async () => {
      if (!confirm("Force Market Rotation? This will disable current market and trigger discovery.")) return;
      await supabase.from('markets').update({ enabled: false });
      alert("Rotation Triggered.");
  };

  const isBotAlive = heartbeat && (Date.now() - new Date(heartbeat.last_seen).getTime() < 30000);
  const timeToExpiry = activeMarket?.t_expiry ? Math.max(0, (new Date(activeMarket.t_expiry).getTime() - Date.now()) / 60000) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans p-6 selection:bg-emerald-900 selection:text-white">
      
      {/* HEADER */}
      <div className="flex justify-between items-start mb-8 border-b border-zinc-800 pb-6">
        <div>
           <h1 className="text-3xl font-mono font-bold text-white flex items-center gap-3">
             <Shield className="text-emerald-500" /> 
             POLYMARKET AUTOPILOT <span className="text-xs bg-zinc-900 text-zinc-500 px-2 py-1 rounded border border-zinc-800">BTC-15M-ONLY</span>
           </h1>
           <p className="text-zinc-500 mt-2 font-mono text-sm">Autonomous High-Frequency Arbitrage System</p>
           
           {/* TAB NAVIGATION */}
           <div className="flex gap-4 mt-6">
               <button 
                onClick={() => setActiveTab('COMMAND')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'COMMAND' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
               >
                   <LayoutDashboard size={16} /> COMMAND CENTER
               </button>
               <button 
                onClick={() => setActiveTab('RESULTS')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'RESULTS' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
               >
                   <LineChart size={16} /> PERFORMANCE
               </button>
           </div>
        </div>
        
        <div className="flex items-center gap-6 mt-2">
            <div className="text-right hidden md:block">
                <div className="text-xs font-bold text-zinc-500 uppercase">System Status</div>
                <div className="flex items-center justify-end gap-2">
                    <span className={`w-2 h-2 rounded-full ${isBotAlive ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
                    <span className={`font-mono font-bold ${isBotAlive ? 'text-emerald-500' : 'text-red-500'}`}>
                        {isBotAlive ? 'ONLINE' : 'OFFLINE'}
                    </span>
                </div>
            </div>
            
            <button 
                onClick={toggleBot}
                className={`px-8 py-4 rounded-lg font-bold text-lg flex items-center gap-3 transition-all shadow-xl ${
                    botStatus === 'running' 
                    ? 'bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500/20 shadow-red-900/20' 
                    : 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-emerald-900/20 hover:scale-105'
                }`}
            >
                {botStatus === 'running' ? <Square fill="currentColor" /> : <Play fill="currentColor" />}
                {botStatus === 'running' ? 'STOP BOT' : 'START BOT'}
            </button>
        </div>
      </div>

      {/* VIEW SWITCHER */}
      {activeTab === 'RESULTS' ? (
          <ResultsView />
      ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">
            {/* LEFT COL: ACTIVE MARKET INTEL */}
            <div className="lg:col-span-2 space-y-6">
                
                {/* ACTIVE MARKET CARD */}
                <div className="bg-black border border-zinc-800 rounded-xl overflow-hidden relative">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-blue-500 opacity-50"></div>
                    
                    <div className="p-6">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h2 className="text-zinc-500 font-bold text-xs uppercase tracking-widest mb-1">CURRENTLY TRADING</h2>
                                {activeMarket ? (
                                    <div className="text-2xl font-bold text-white font-mono break-all">
                                        {activeMarket.polymarket_market_id}
                                    </div>
                                ) : (
                                    <div className="text-xl text-zinc-600 font-mono italic">
                                        Scanning for active BTC markets...
                                    </div>
                                )}
                            </div>
                            {activeMarket && (
                                <div className="text-right">
                                    <div className="text-zinc-500 text-xs uppercase">Expires In</div>
                                    <div className={`text-3xl font-mono font-bold ${timeToExpiry < 5 ? 'text-red-500 animate-pulse' : 'text-emerald-400'}`}>
                                        {timeToExpiry.toFixed(1)}m
                                    </div>
                                </div>
                            )}
                        </div>

                        {activeMarket && marketState && (
                            <div className="grid grid-cols-4 gap-4 bg-zinc-900/30 p-4 rounded-lg border border-zinc-800">
                                <div>
                                    <div className="text-[10px] text-zinc-500 uppercase">Spot Price</div>
                                    <div className="text-lg font-mono text-white">${marketState.spot_price_median.toFixed(2)}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-zinc-500 uppercase">Baseline</div>
                                    <div className="text-lg font-mono text-zinc-400">${activeMarket.baseline_price?.toFixed(2) || '---'}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-zinc-500 uppercase">Delta</div>
                                    <div className={`text-lg font-mono font-bold ${marketState.delta > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {marketState.delta > 0 ? '+' : ''}{marketState.delta.toFixed(2)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-zinc-500 uppercase">Confidence</div>
                                    <div className="text-lg font-mono font-bold text-blue-400">{(marketState.confidence * 100).toFixed(0)}%</div>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="bg-zinc-900 px-6 py-3 border-t border-zinc-800 flex justify-between items-center">
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <Activity size={14} />
                            Last Activity: <span className="text-zinc-300 font-mono">{lastLog || 'Waiting...'}</span>
                        </div>
                        <button onClick={handleManualRotation} className="text-xs text-zinc-600 hover:text-white flex items-center gap-1">
                            <RefreshCcw size={12} /> Force Rotate
                        </button>
                    </div>
                </div>

                {/* TERMINAL */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 min-h-[300px]">
                    <h3 className="text-sm font-bold text-zinc-400 uppercase mb-4 flex items-center gap-2">
                        <Terminal size={16} /> Live Execution Stream
                    </h3>
                    <div className="font-mono text-xs space-y-2 text-zinc-400">
                        {activeMarket ? (
                            <>
                            <div className="text-emerald-500">{'>'} [AUTO] Locked on market: {activeMarket.polymarket_market_id.substring(0, 40)}...</div>
                            <div>{'>'} [EDGE] Monitoring volatility... Regime: {marketState?.status || 'WATCHING'}</div>
                            {marketState && marketState.exposure > 0 && (
                                <div className="text-yellow-500">{'>'} [RISK] Current Exposure: ${marketState.exposure.toFixed(2)}</div>
                            )}
                            <div className="opacity-50">{'>'} Waiting for signal...</div>
                            </>
                        ) : (
                            <div className="text-zinc-600 animate-pulse">{'>'} system_idle: waiting for market discovery...</div>
                        )}
                    </div>
                </div>

            </div>

            {/* RIGHT COL: RISK CONTROL */}
            <div className="space-y-6">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-lg">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-sm font-bold text-white uppercase flex items-center gap-2">
                            <Shield size={16} className="text-emerald-500" /> Risk Control
                        </h3>
                        <button 
                            onClick={saveConfig}
                            disabled={isSaving}
                            className="text-xs bg-emerald-900/30 text-emerald-500 border border-emerald-900 hover:bg-emerald-900/50 px-3 py-1 rounded transition-colors flex items-center gap-1"
                        >
                            {isSaving ? 'SAVING...' : <><Save size={12} /> UPDATE LIMITS</>}
                        </button>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <label className="text-xs text-zinc-500 font-bold uppercase mb-2 block flex justify-between">
                                <span>Maximum Capital Exposure</span>
                                <span className="text-white text-lg">${config.maxExposure}</span>
                            </label>
                            <input 
                                type="range" min="50" max="2000" step="50"
                                value={config.maxExposure}
                                onChange={(e) => setConfig({ maxExposure: parseFloat(e.target.value) })}
                                className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                            />
                            <div className="flex justify-between text-[10px] text-zinc-600 font-mono mt-2">
                                <span>$50</span>
                                <span>$2000</span>
                            </div>
                        </div>

                        <div className="flex items-start gap-3 bg-zinc-950/50 p-4 rounded border border-zinc-800">
                            <Info size={16} className="text-zinc-500 mt-0.5" />
                            <p className="text-xs text-zinc-400 leading-relaxed">
                                This is a hard risk limit. The autonomous agent will manage trade sizing and frequency internally, but will <strong>never</strong> exceed ${config.maxExposure} in total allocation.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
          </div>
      )}
    </div>
  );
};
