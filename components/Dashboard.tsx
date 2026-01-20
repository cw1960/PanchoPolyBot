
import React, { useState, useEffect } from 'react';
import { 
  Play, Square, Shield, LayoutDashboard, LineChart, 
  BarChart2, Wallet, Microscope, Settings, Save, RotateCcw 
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// Sub-Views
import { MarketsView } from './MarketsView';
import { BankrollView } from './BankrollView';
import { ResearchView } from './ResearchView';

const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface ActiveMarket {
    id: string;
    polymarket_market_id: string;
    asset: string;
    t_expiry?: string;
    baseline_price?: number;
}

interface MarketState {
    confidence: number;
    delta: number;
    exposure: number;
    spot_price_median: number;
    status: string;
}

export const Dashboard: React.FC = () => {
  // Navigation State
  const [activeTab, setActiveTab] = useState<'COMMAND' | 'MARKETS' | 'BANKROLL' | 'RESEARCH'>('COMMAND');
  const [showSettings, setShowSettings] = useState(false);

  // Core State
  const [activeMarket, setActiveMarket] = useState<ActiveMarket | null>(null);
  const [marketState, setMarketState] = useState<MarketState | null>(null);
  
  // Controls
  const [botStatus, setBotStatus] = useState<'running' | 'stopped'>('stopped');
  const [config, setConfig] = useState({ maxExposure: 100, bankroll: 500 });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000); 
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
  };

  const toggleBot = async () => {
      const newState = botStatus === 'running' ? 'stopped' : 'running';
      await supabase.from('bot_control').update({ desired_state: newState }).eq('id', 1);
      setBotStatus(newState);
  };

  const saveConfig = async () => {
      setIsSaving(true);
      // Update persistent run config
      await supabase.from('test_runs')
        .update({ 
            params: { 
                maxExposure: config.maxExposure,
                startingBankroll: config.bankroll 
            } 
        })
        .eq('name', 'AUTO_TRADER_GLOBAL_CONFIG');
      
      // Update global control timestamp to force bot reload
      await supabase.from('bot_control').update({ updated_at: new Date().toISOString() }).eq('id', 1);
      
      setTimeout(() => { setIsSaving(false); setShowSettings(false); }, 1000);
  };

  const resetPaper = async () => {
      if(!confirm("Resetting will wipe recent ticks and start a fresh simulated run. Continue?")) return;
      // In a real app this might archive data. For MVP we just update the run timestamp to force clean slate.
      await supabase.from('test_runs').update({ 
          status: 'COMPLETED' 
      }).eq('name', 'AUTO_TRADER_GLOBAL_CONFIG');
      
      // Create new
      await supabase.from('test_runs').insert({
           name: 'AUTO_TRADER_GLOBAL_CONFIG',
           status: 'RUNNING',
           params: { maxExposure: config.maxExposure }
      });
      alert("Paper environment reset.");
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans p-6 selection:bg-emerald-900 selection:text-white">
      
      {/* HEADER */}
      <div className="flex justify-between items-start mb-8 border-b border-zinc-800 pb-6">
        <div>
           <h1 className="text-3xl font-mono font-bold text-white flex items-center gap-3">
             <Shield className="text-emerald-500" /> 
             POLYMARKET AUTOPILOT <span className="text-xs bg-zinc-900 text-zinc-500 px-2 py-1 rounded border border-zinc-800">BTC-15M</span>
           </h1>
           
           {/* MAIN NAV */}
           <div className="flex gap-2 mt-6">
               <NavButton active={activeTab === 'COMMAND'} onClick={() => setActiveTab('COMMAND')} icon={<LayoutDashboard size={16} />} label="COMMAND" />
               <NavButton active={activeTab === 'MARKETS'} onClick={() => setActiveTab('MARKETS')} icon={<BarChart2 size={16} />} label="MARKETS" />
               <NavButton active={activeTab === 'BANKROLL'} onClick={() => setActiveTab('BANKROLL')} icon={<Wallet size={16} />} label="BANKROLL" />
               <NavButton active={activeTab === 'RESEARCH'} onClick={() => setActiveTab('RESEARCH')} icon={<Microscope size={16} />} label="RESEARCH" />
           </div>
        </div>
        
        <div className="flex items-center gap-4 mt-2">
            <button 
                onClick={() => setShowSettings(!showSettings)}
                className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors"
            >
                <Settings size={20} />
            </button>
            
            <button 
                onClick={toggleBot}
                className={`px-8 py-3 rounded-lg font-bold text-lg flex items-center gap-3 transition-all shadow-xl ${
                    botStatus === 'running' 
                    ? 'bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500/20' 
                    : 'bg-emerald-500 text-black hover:bg-emerald-400'
                }`}
            >
                {botStatus === 'running' ? <Square fill="currentColor" size={16} /> : <Play fill="currentColor" size={16} />}
                {botStatus === 'running' ? 'STOP BOT' : 'START BOT'}
            </button>
        </div>
      </div>

      {/* SETTINGS DRAWER */}
      {showSettings && (
          <div className="mb-8 bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 animate-in slide-in-from-top-4">
              <h3 className="text-sm font-bold text-white uppercase mb-4 flex items-center gap-2">
                  <Settings size={16} /> Global Configuration
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                      <label className="text-xs text-zinc-500 font-bold uppercase block mb-2">Max Capital Exposure ($)</label>
                      <input 
                        type="number" 
                        value={config.maxExposure}
                        onChange={(e) => setConfig({...config, maxExposure: parseFloat(e.target.value)})}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-white font-mono"
                      />
                  </div>
                  <div>
                      <label className="text-xs text-zinc-500 font-bold uppercase block mb-2">Bankroll Reset ($)</label>
                      <input 
                        type="number" 
                        value={config.bankroll}
                        onChange={(e) => setConfig({...config, bankroll: parseFloat(e.target.value)})}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-white font-mono"
                      />
                  </div>
                  <div className="flex items-end gap-2">
                      <button 
                        onClick={saveConfig}
                        disabled={isSaving}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 rounded flex items-center justify-center gap-2"
                      >
                          <Save size={16} /> {isSaving ? 'Saving...' : 'Apply Config'}
                      </button>
                      <button 
                        onClick={resetPaper}
                        className="px-4 bg-zinc-800 hover:bg-red-900/30 text-zinc-400 hover:text-red-500 border border-zinc-700 hover:border-red-800 font-bold py-2 rounded flex items-center justify-center gap-2"
                        title="Reset Paper Trading Data"
                      >
                          <RotateCcw size={16} />
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* CONTENT AREA */}
      <div className="min-h-[500px]">
          {activeTab === 'COMMAND' && (
              <CommandView activeMarket={activeMarket} marketState={marketState} />
          )}
          {activeTab === 'MARKETS' && <MarketsView />}
          {activeTab === 'BANKROLL' && <BankrollView />}
          {activeTab === 'RESEARCH' && <ResearchView />}
      </div>
    </div>
  );
};

const NavButton = ({ active, onClick, icon, label }: any) => (
    <button 
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
            active 
            ? 'bg-zinc-800 text-white shadow-lg ring-1 ring-zinc-700' 
            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
        }`}
    >
        {icon} {label}
    </button>
);

// --- REFACTORED COMMAND VIEW (Legacy Dashboard Content) ---
const CommandView = ({ activeMarket, marketState }: any) => {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in duration-300">
            {/* Active Market Card */}
            <div className="bg-black border border-zinc-800 rounded-xl overflow-hidden relative min-h-[300px]">
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
                    </div>

                    {activeMarket && marketState && (
                        <div className="grid grid-cols-2 gap-4 mt-8">
                            <div className="bg-zinc-900/50 p-4 rounded border border-zinc-800">
                                <div className="text-[10px] text-zinc-500 uppercase font-bold">Spot Price</div>
                                <div className="text-2xl font-mono text-white">${marketState.spot_price_median.toFixed(2)}</div>
                            </div>
                            <div className="bg-zinc-900/50 p-4 rounded border border-zinc-800">
                                <div className="text-[10px] text-zinc-500 uppercase font-bold">Delta</div>
                                <div className={`text-2xl font-mono font-bold ${marketState.delta > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {marketState.delta > 0 ? '+' : ''}{marketState.delta.toFixed(2)}
                                </div>
                            </div>
                            <div className="bg-zinc-900/50 p-4 rounded border border-zinc-800">
                                <div className="text-[10px] text-zinc-500 uppercase font-bold">Model Confidence</div>
                                <div className="text-2xl font-mono font-bold text-blue-400">{(marketState.confidence * 100).toFixed(1)}%</div>
                            </div>
                            <div className="bg-zinc-900/50 p-4 rounded border border-zinc-800">
                                <div className="text-[10px] text-zinc-500 uppercase font-bold">Current Exposure</div>
                                <div className="text-2xl font-mono font-bold text-yellow-500">${marketState.exposure.toFixed(2)}</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Live Feed Placeholder */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-sm font-bold text-zinc-400 uppercase mb-4 flex items-center gap-2">
                    <LineChart size={16} /> Live Strategy Feed
                </h3>
                <div className="font-mono text-xs space-y-2 text-zinc-500">
                    <div>{'>'} System initialized...</div>
                    <div>{'>'} Waiting for next tick...</div>
                    {activeMarket && (
                        <div className="text-emerald-500">{'>'} Market Active: {activeMarket.polymarket_market_id}</div>
                    )}
                </div>
            </div>
        </div>
    );
};
