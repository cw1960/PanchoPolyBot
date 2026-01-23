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
  // Navigation
  const [activeTab, setActiveTab] =
    useState<'COMMAND' | 'MARKETS' | 'BANKROLL' | 'RESEARCH'>('COMMAND');
  const [showSettings, setShowSettings] = useState(false);

  // Core
  const [activeMarket, setActiveMarket] = useState<ActiveMarket | null>(null);
  const [marketState, setMarketState] = useState<MarketState | null>(null);

  // Controls
  const [botStatus, setBotStatus] = useState<'running' | 'stopped'>('stopped');
  const [config, setConfig] = useState({ maxExposure: 100, bankroll: 500 });
  const [isSaving, setIsSaving] = useState(false);

  // === ADDITIVE TELEMETRY ===
  const [estimatedReturn, setEstimatedReturn] = useState<number>(0);

  useEffect(() => {
    fetchData();
    loadEstimatedReturn();
    const interval = setInterval(() => {
      fetchData();
      loadEstimatedReturn();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    const { data: ctrl } = await supabase
      .from('bot_control')
      .select('desired_state')
      .eq('id', 1)
      .single();

    if (ctrl) setBotStatus(ctrl.desired_state);

    const { data: markets } = await supabase
      .from('markets')
      .select('*')
      .eq('enabled', true);

    if (markets && markets.length > 0) {
      const m = markets[0];
      setActiveMarket(m);

      const { data: state } = await supabase
        .from('market_state')
        .select('*')
        .eq('market_id', m.id)
        .maybeSingle();

      if (state) setMarketState(state);
    } else {
      setActiveMarket(null);
      setMarketState(null);
    }
  };

  // === ESTIMATED RETURN (FAIL-CLOSED) ===
  const loadEstimatedReturn = async () => {
    const { data: settlements } = await supabase
      .from('bot_settlements')
      .select('slug');

    const settled = new Set((settlements || []).map(s => s.slug));

    const { data: ticks } = await supabase
      .from('bot_ticks')
      .select('slug, expected_pnl');

    if (!ticks) {
      setEstimatedReturn(0);
      return;
    }

    const sum = ticks
      .filter(t => !settled.has(t.slug))
      .reduce((a, t) => a + Number(t.expected_pnl || 0), 0);

    setEstimatedReturn(sum);
  };

  const toggleBot = async () => {
    const newState = botStatus === 'running' ? 'stopped' : 'running';
    await supabase.from('bot_control')
      .update({ desired_state: newState })
      .eq('id', 1);
    setBotStatus(newState);
  };

  const saveConfig = async () => {
    setIsSaving(true);
    await supabase.from('test_runs')
      .update({ params: { maxExposure: config.maxExposure, startingBankroll: config.bankroll } })
      .eq('name', 'AUTO_TRADER_GLOBAL_CONFIG');

    await supabase.from('bot_control')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', 1);

    setTimeout(() => { setIsSaving(false); setShowSettings(false); }, 1000);
  };

  const resetPaper = async () => {
    if (!confirm('Resetting will wipe recent ticks and start fresh. Continue?')) return;
    await supabase.from('test_runs')
      .update({ status: 'COMPLETED' })
      .eq('name', 'AUTO_TRADER_GLOBAL_CONFIG');

    await supabase.from('test_runs').insert({
      name: 'AUTO_TRADER_GLOBAL_CONFIG',
      status: 'RUNNING',
      params: { maxExposure: config.maxExposure }
    });

    alert('Paper environment reset.');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 p-6">
      {/* HEADER */}
      <div className="flex justify-between items-start mb-8 border-b border-zinc-800 pb-6">
        <div>
          <h1 className="text-3xl font-mono font-bold text-white flex items-center gap-3">
            <Shield className="text-emerald-500" /> POLYMARKET AUTOPILOT
          </h1>

          <div className="flex gap-2 mt-6">
            <NavButton active={activeTab==='COMMAND'} onClick={()=>setActiveTab('COMMAND')} icon={<LayoutDashboard size={16}/>} label="COMMAND"/>
            <NavButton active={activeTab==='MARKETS'} onClick={()=>setActiveTab('MARKETS')} icon={<BarChart2 size={16}/>} label="MARKETS"/>
            <NavButton active={activeTab==='BANKROLL'} onClick={()=>setActiveTab('BANKROLL')} icon={<Wallet size={16}/>} label="BANKROLL"/>
            <NavButton active={activeTab==='RESEARCH'} onClick={()=>setActiveTab('RESEARCH')} icon={<Microscope size={16}/>} label="RESEARCH"/>
          </div>
        </div>

        <button
          onClick={toggleBot}
          className={`px-6 py-3 rounded font-bold ${
            botStatus==='running'
              ? 'bg-red-500/10 text-red-500 border border-red-500/50'
              : 'bg-emerald-500 text-black'
          }`}
        >
          {botStatus==='running' ? 'STOP BOT' : 'START BOT'}
        </button>
      </div>

      {/* COMMAND VIEW */}
      {activeTab === 'COMMAND' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <MetricCard label="Estimated Return" value={estimatedReturn.toFixed(4)} />
          <MetricCard label="Active Market" value={activeMarket?.polymarket_market_id ?? '—'} />
          <MetricCard label="Model Confidence" value={marketState ? `${(marketState.confidence*100).toFixed(1)}%` : '—'} />
        </div>
      )}

      {activeTab === 'MARKETS' && <MarketsView />}
      {activeTab === 'BANKROLL' && <BankrollView />}
      {activeTab === 'RESEARCH' && <ResearchView />}
    </div>
  );
};

const MetricCard = ({ label, value }: any) => (
  <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
    <div className="text-xs uppercase text-zinc-500">{label}</div>
    <div className="text-2xl font-mono text-white">{value}</div>
  </div>
);

const NavButton = ({ active, onClick, icon, label }: any) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded ${
      active ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-900'
    }`}
  >
    {icon} {label}
  </button>
);
