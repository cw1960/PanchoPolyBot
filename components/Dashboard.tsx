
import React, { useState, useEffect } from 'react';
import { 
  Play, Square, Activity, Shield, 
  Terminal, Zap, RefreshCcw, Save,
  TrendingUp, Clock, Target, AlertTriangle, Info
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

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
    direction: 'UP' | 'DOWN' | 'BOTH';
    tradeSize: number;
    maxExposure: number;
    confidenceThreshold: number;
    cooldown: number;
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
  // State
  const [activeMarket, setActiveMarket] = useState<ActiveMarket | null>(null);
  const [marketState, setMarketState] = useState<MarketState | null>(null);
  const [config, setConfig] = useState<GlobalConfig>({
      direction: 'BOTH', tradeSize: 10, maxExposure: 100, confidenceThreshold: 0.6, cooldown: 10000
  });
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
      // 1. Bot Control Status
      const { data: ctrl } = await supabase.from('bot_control').select('desired_state').eq('id', 1).single();
      if (ctrl) setBotStatus(ctrl.desired_state);

      // 2. Active Market (The Highlander)
      const { data: markets } = await supabase.from('markets').select('*').eq('enabled', true);
      if (markets && markets.length > 0) {
          const m = markets[0]; // Should only be one
          setActiveMarket(m);
          
          // 3. Market Live State
          const { data: state } = await supabase.from('market_state').select('*').eq('market_id', m.id).maybeSingle();
          if (state) setMarketState(state);
      } else {
          setActiveMarket(null);
          setMarketState(null);
      }

      // 4. Global Config
      const { data: run } = await supabase.from('test_runs').select('params').eq('name', 'AUTO_TRADER_GLOBAL_CONFIG').maybeSingle();
      if (run && run.params && !isSaving) { // Don't overwrite if user is typing
         // Merge in case we added new fields
         setConfig(prev => ({ ...prev, ...run.params }));
      }

      // 5. Heartbeat
      const { data: hb } = await supabase.from('bot_heartbeats').select('*').order('last_seen', {ascending: false}).limit(1).maybeSingle();
      if (hb) setHeartbeat(hb);
      
      // 6. Recent Trade Log
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
      // Update the Persistent Global Run
      const { error } = await supabase.from('test_runs')
        .update({ params: config })
        .eq('name', 'AUTO_TRADER_GLOBAL_CONFIG');
        
      if (error) alert("Failed to save config");
      
      // Also Force Sync Control
      await supabase.from('bot_control').update({ updated_at: new Date().toISOString() }).eq('id', 1);
      
      setTimeout(() => setIsSaving(false), 1000);
  };

  const handleManualRotation = async () => {
      if (!confirm("Force Market Rotation? This will disable current market and trigger discovery.")) return;
      await supabase.from('markets').update({ enabled: false }); // Disable all
      alert("Rotation Triggered. Bot will scan for new market on next tick.");
  };

  // Helpers
  const isBotAlive = heartbeat && (Date.now() - new Date(heartbeat.last_seen).getTime() < 30000);
  const timeToExpiry = activeMarket?.t_expiry ? Math.max(0, (new Date(activeMarket.t_expiry).getTime() - Date.now()) / 60000) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans p-6 selection:bg-emerald-900 selection:text-white">
      
      {/* HEADER */}
      <div className="flex justify-between items-center mb-8 border-b border-zinc-800 pb-6">
        <div>
           <h1 className="text-3xl font-mono font-bold text-white flex items-center gap-3">
             <Shield className="text-emerald-500" /> 
             POLYMARKET AUTOPILOT <span className="text-xs bg-zinc-900 text-zinc-500 px-2 py-1 rounded border border-zinc-800">BTC-15M-ONLY</span>
           </h1>
           <p className="text-zinc-500 mt-2 font-mono text-sm">Autonomous High-Frequency Arbitrage System</p>
        </div>
        
        <div className="flex items-center gap-6">
            <div className="text-right">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COL: ACTIVE MARKET INTEL */}
        <div className="lg:col-span-2 space-y-6">
            
            {/* 1. THE ACTIVE MARKET CARD */}
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
                
                {/* Manual Override */}
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

            {/* 2. REAL-TIME LOGS / TERMINAL */}
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

        {/* RIGHT COL: STRATEGY CONFIG */}
        <div className="space-y-6">
            
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-lg">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-bold text-white uppercase flex items-center gap-2">
                        <Zap size={16} className="text-yellow-500" /> Strategy Config
                    </h3>
                    <button 
                        onClick={saveConfig}
                        disabled={isSaving}
                        className="text-xs bg-emerald-900/30 text-emerald-500 border border-emerald-900 hover:bg-emerald-900/50 px-3 py-1 rounded transition-colors flex items-center gap-1"
                    >
                        {isSaving ? 'SAVING...' : <><Save size={12} /> SAVE UPDATES</>}
                    </button>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block">Trade Direction</label>
                        <div className="flex bg-zinc-950 rounded p-1 border border-zinc-800">
                            {['UP', 'BOTH', 'DOWN'].map(d => (
                                <button
                                    key={d}
                                    onClick={() => setConfig({...config, direction: d as any})}
                                    className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${config.direction === d ? 'bg-zinc-800 text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block flex justify-between">
                            <span>Base Trade Size</span>
                            <span className="text-white">${config.tradeSize}</span>
                        </label>
                        <input 
                            type="range" min="1" max="100" step="1"
                            value={config.tradeSize}
                            onChange={(e) => setConfig({...config, tradeSize: parseFloat(e.target.value)})}
                            className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        />
                    </div>

                    <div>
                        <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block flex justify-between">
                            <span>Max Exposure (Budget)</span>
                            <span className="text-white">${config.maxExposure}</span>
                        </label>
                        <input 
                            type="range" min="50" max="1000" step="10"
                            value={config.maxExposure}
                            onChange={(e) => setConfig({...config, maxExposure: parseFloat(e.target.value)})}
                            className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                    </div>

                    <div>
                        <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block flex justify-between">
                            <span>Confidence Threshold</span>
                            <span className="text-white">{(config.confidenceThreshold * 100).toFixed(0)}%</span>
                        </label>
                        <input 
                            type="range" min="0.5" max="0.95" step="0.05"
                            value={config.confidenceThreshold}
                            onChange={(e) => setConfig({...config, confidenceThreshold: parseFloat(e.target.value)})}
                            className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                    </div>

                     <div className="pt-4 border-t border-zinc-800">
                        <div className="flex items-start gap-2 bg-blue-900/10 p-3 rounded border border-blue-900/30">
                            <Info size={14} className="text-blue-500 mt-0.5" />
                            <p className="text-[10px] text-blue-300 leading-relaxed">
                                Changes apply immediately to the next tick. The bot will automatically scale out of positions if risk parameters are lowered below current exposure.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

             <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                 <h3 className="text-sm font-bold text-zinc-400 uppercase mb-4">Risk Guards</h3>
                 <div className="space-y-2">
                     <div className="flex justify-between text-xs">
                         <span className="text-zinc-500">Stop Loss</span>
                         <span className="text-zinc-300">Automatic (Regime Flip)</span>
                     </div>
                     <div className="flex justify-between text-xs">
                         <span className="text-zinc-500">Expiry Cutoff</span>
                         <span className="text-zinc-300">3 Minutes</span>
                     </div>
                     <div className="flex justify-between text-xs">
                         <span className="text-zinc-500">Max Volatility</span>
                         <span className="text-zinc-300">2.5% / min</span>
                     </div>
                 </div>
             </div>

        </div>

      </div>
    </div>
  );
};
