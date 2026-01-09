
import React, { useState, useEffect } from 'react';
import { 
  Play, Pause, Square, Save, Activity, Shield, 
  Terminal, BarChart3, Microscope, FastForward, History,
  Settings, Database, FlaskConical, Target, TrendingUp, Filter,
  CheckCircle, XCircle, AlertTriangle, Plus, Clipboard, Power, RefreshCw,
  BrainCircuit, FileText, Search
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// --- SUPABASE CLIENT ---
const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- TYPES ---

interface FeeConfig {
  id: number;
  buy_fee_peak_pct: number;
  buy_fee_peak_at_prob: number;
  sell_fee_peak_pct: number;
  sell_fee_peak_at_prob: number;
  min_fee_pct: number;
  shape_exponent: number;
}

interface TestRun {
  id: string;
  created_at: string;
  name: string;
  status: 'PLANNED' | 'RUNNING' | 'COMPLETED' | 'ABORTED';
  hypothesis: string;
  start_at: string;
  end_at: string;
  params: any;
}

interface TradeEvent {
  id: string;
  created_at: string;
  test_run_id: string;
  market_id: string;
  asset: string;
  side: string;
  stake_usd: number;
  entry_prob: number;
  confidence: number;
  status: string;
  decision_reason: string;
  outcome: 'WIN' | 'LOSS' | 'DRAW' | 'OPEN';
  edge_after_fees_pct: number;
  ev_after_fees_usd: number;
  signals: any;
  realized_pnl_usd: number;
}

interface BotHeartbeat {
  id: string;
  last_seen: string;
  active_markets: number;
  status: string;
}

interface MarketRow {
    id: string;
    polymarket_market_id: string;
    enabled: boolean;
    active_run_id?: string;
}

// --- UTILS ---
const formatPct = (val: number) => `${(val * 100).toFixed(2)}%`;
const formatUsd = (val: number) => `$${val.toFixed(3)}`;

// --- COMPONENT ---

export const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'TRADES' | 'PERF' | 'FEES' | 'TEST' | 'CALIBRATION' | 'INTEL'>('TEST');
  const [feeConfig, setFeeConfig] = useState<FeeConfig | null>(null);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [activeTestRunId, setActiveTestRunId] = useState<string | 'ALL'>('ALL');
  
  // New Run State
  const [newRunName, setNewRunName] = useState("");
  const [newRunHypothesis, setNewRunHypothesis] = useState("");
  const [targetSlug, setTargetSlug] = useState("");

  // Bot Status
  const [botHeartbeat, setBotHeartbeat] = useState<BotHeartbeat | null>(null);
  const [desiredState, setDesiredState] = useState<'running'|'stopped'>('stopped');

  // Intel State
  const [intelInput, setIntelInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [intelResult, setIntelResult] = useState<{ score: number, bias: string, keywords: string[] } | null>(null);


  useEffect(() => {
    fetchFeeConfig();
    fetchTestRuns();
    fetchTrades();
    fetchBotStatus();
    
    const interval = setInterval(() => {
        fetchTrades();
        fetchBotStatus();
    }, 5000); 
    return () => clearInterval(interval);
  }, [activeTestRunId]);

  const fetchBotStatus = async () => {
      const { data: heartbeat } = await supabase.from('bot_heartbeats').select('*').limit(1).single();
      if (heartbeat) setBotHeartbeat(heartbeat);

      const { data: control } = await supabase.from('bot_control').select('desired_state').single();
      if (control) setDesiredState(control.desired_state);
  }

  const fetchFeeConfig = async () => {
    const { data } = await supabase.from('fee_config').select('*').single();
    if (data) setFeeConfig(data);
  };

  const fetchTestRuns = async () => {
    const { data } = await supabase.from('test_runs').select('*').order('created_at', { ascending: false });
    if (data) setTestRuns(data);
  };

  const fetchTrades = async () => {
    let query = supabase.from('trade_events').select('*').order('created_at', { ascending: false }).limit(100);
    if (activeTestRunId !== 'ALL') {
      query = query.eq('test_run_id', activeTestRunId);
    }
    const { data } = await query;
    if (data) setTrades(data);
  };

  // --- ACTIONS ---

  const handleStartTest = async () => {
      if (!newRunName || !targetSlug) {
          alert("Please enter both a Run Name and a Market Slug.");
          return;
      }

      // 1. Create Run
      const { data: runData, error } = await supabase.from('test_runs').insert({
        name: newRunName,
        hypothesis: newRunHypothesis || 'Automated UI Test',
        status: 'RUNNING',
        start_at: new Date().toISOString(),
        params: { targetSlug }
      }).select().single();

      if (error || !runData) {
          alert("Failed to create test run");
          return;
      }

      // 2. Configure Market (Enable & Link)
      // Check if market exists, if not, maybe we should warn, but assuming VPS syncs it or we upsert:
      // We assume VPS syncs structure. We just update.
      await supabase.from('markets').update({
          enabled: true,
          active_run_id: runData.id,
          polymarket_market_id: targetSlug // Ensure slug matches
      }).eq('polymarket_market_id', targetSlug);
      
      // Upserting for safety:
      const { data: marketCheck } = await supabase.from('markets').select('id').eq('polymarket_market_id', targetSlug).single();
      if (!marketCheck) {
          await supabase.from('markets').insert({
              polymarket_market_id: targetSlug,
              asset: 'BTC', // Default fallback
              enabled: true,
              active_run_id: runData.id,
              direction: 'UP',
              max_exposure: 50
          });
      }

      // 3. Start Bot
      await supabase.from('bot_control').update({ desired_state: 'running' }).eq('id', 1);

      // UI Reset
      setNewRunName("");
      setNewRunHypothesis("");
      fetchTestRuns();
      fetchBotStatus();
      alert(`Test "${runData.name}" Started!`);
  };

  const handleStopTest = async (runId: string) => {
      // 1. Stop Run
      await supabase.from('test_runs').update({ 
          status: 'COMPLETED', 
          end_at: new Date().toISOString() 
      }).eq('id', runId);

      // 2. Stop Bot (Global Safety)
      await supabase.from('bot_control').update({ desired_state: 'stopped' }).eq('id', 1);

      // 3. Disable Markets linked to this run
      await supabase.from('markets').update({ enabled: false, active_run_id: null }).eq('active_run_id', runId);

      fetchTestRuns();
      fetchBotStatus();
  };

  const handleResetExposure = async (marketSlug: string) => {
      if (!marketSlug) return;
      // Get Market ID
      const { data: m } = await supabase.from('markets').select('id').eq('polymarket_market_id', marketSlug).single();
      if (m) {
          await supabase.from('market_state').update({ exposure: 0 }).eq('market_id', m.id);
          alert(`Exposure reset to $0 for ${marketSlug}`);
      } else {
          alert("Market not found in DB.");
      }
  };

  const simulateOutcome = async (trade: TradeEvent) => {
    const expiryTime = new Date(new Date(trade.created_at).getTime() + 15 * 60000);
    if (new Date() < expiryTime) {
      alert("Trade has not expired yet (15m rule)");
      return;
    }
    const simulatedOutcome = Math.random() > 0.45 ? 'WIN' : 'LOSS';
    const pnl = simulatedOutcome === 'WIN' ? trade.stake_usd : -trade.stake_usd;

    await supabase.from('trade_events').update({
      outcome: simulatedOutcome,
      realized_pnl_usd: pnl,
      status: 'SETTLED'
    }).eq('id', trade.id);
    fetchTrades();
  };

  const handleAnalyzeIntel = () => {
    if (!intelInput) return;
    setIsAnalyzing(true);
    setIntelResult(null);

    // Simulated NLP Process
    setTimeout(() => {
        const text = intelInput.toLowerCase();
        
        // Simple Bag-of-Words Sentiment
        const bullTerms = ['record', 'high', 'growth', 'adoption', 'launch', 'win', 'profit', 'bull', 'inception', 'success', 'breakthrough'];
        const bearTerms = ['controversial', 'regulatory', 'ban', 'fine', 'crash', 'loss', 'bear', 'risk', 'investigation', 'fraud', 'warn'];
        
        let score = 0;
        const hits: string[] = [];
        
        bullTerms.forEach(t => { 
            if(text.includes(t)) { score += 1; hits.push(t); } 
        });
        bearTerms.forEach(t => { 
            if(text.includes(t)) { score -= 1; hits.push(t); } 
        });
        
        let bias = 'NEUTRAL';
        if (score > 0) bias = 'BULLISH';
        if (score < 0) bias = 'BEARISH';
        
        setIntelResult({ score, bias, keywords: [...new Set(hits)] });
        setIsAnalyzing(false);
    }, 1500);
  };

  // --- RENDER HELPERS ---
  const renderBotStatus = () => {
      const isAlive = botHeartbeat && (new Date().getTime() - new Date(botHeartbeat.last_seen).getTime()) < 30000; // 30s timeout
      
      return (
          <div className="bg-zinc-900 border border-zinc-800 rounded p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-full ${isAlive ? 'bg-emerald-950/50' : 'bg-red-950/50'}`}>
                      <Activity className={isAlive ? "text-emerald-500 animate-pulse" : "text-red-500"} size={20} />
                  </div>
                  <div>
                      <h3 className="text-sm font-bold text-white">Bot Status</h3>
                      <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-2 py-0.5 rounded border ${
                              desiredState === 'running' ? 'bg-emerald-900/30 text-emerald-400 border-emerald-900' : 'bg-red-900/30 text-red-400 border-red-900'
                          }`}>
                              TARGET: {desiredState.toUpperCase()}
                          </span>
                          <span className="text-xs text-zinc-500 font-mono">
                              LAST SEEN: {botHeartbeat ? new Date(botHeartbeat.last_seen).toLocaleTimeString() : 'NEVER'}
                          </span>
                      </div>
                  </div>
              </div>
              <div className="text-right">
                  <div className="text-xs text-zinc-500 uppercase">Active Markets</div>
                  <div className="text-2xl font-mono font-bold text-white">{botHeartbeat?.active_markets || 0}</div>
              </div>
          </div>
      );
  };

  const renderCalibration = () => {
    const bins = [0.5, 0.6, 0.7, 0.8, 0.9];
    const stats = bins.map(binLow => {
      const binHigh = binLow + 0.1;
      const binTrades = trades.filter(t => t.confidence >= binLow && t.confidence < binHigh && t.status === 'SETTLED');
      const wins = binTrades.filter(t => t.outcome === 'WIN').length;
      const rate = binTrades.length > 0 ? wins / binTrades.length : 0;
      return { binLow, binHigh, count: binTrades.length, rate };
    });

    return (
      <div className="grid grid-cols-5 gap-4">
        {stats.map(stat => (
          <div key={stat.binLow} className="bg-zinc-900 border border-zinc-800 p-4 rounded text-center">
             <div className="text-zinc-500 text-xs font-mono mb-2">{stat.binLow.toFixed(1)} - {stat.binHigh.toFixed(1)}</div>
             <div className={`text-2xl font-bold ${stat.rate > stat.binLow ? 'text-emerald-500' : 'text-yellow-500'}`}>
               {(stat.rate * 100).toFixed(0)}%
             </div>
             <div className="text-zinc-600 text-[10px] mt-1">{stat.count} Trades</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans p-6 selection:bg-emerald-900 selection:text-white">
      
      {/* HEADER */}
      <div className="mb-6 border-b border-zinc-800 pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-mono font-bold text-white flex items-center gap-3">
            <Microscope className="text-emerald-500" />
            ARBINTEL LABS <span className="text-zinc-600 text-sm px-2 py-0.5 border border-zinc-800 rounded">v3.1 (CONTROL)</span>
          </h1>
          <p className="text-zinc-500 text-sm mt-1 font-mono">
            Scientific Trading Framework • Test Harness • Outcome Simulation
          </p>
        </div>
        
        {/* Global Test Filter */}
        <div className="flex items-center gap-2">
            <label className="text-[10px] text-zinc-500 font-bold uppercase mr-2">Context:</label>
            <select 
              className="bg-zinc-900 border border-zinc-800 text-xs rounded p-2 text-white outline-none"
              value={activeTestRunId}
              onChange={e => setActiveTestRunId(e.target.value)}
            >
              <option value="ALL">All History</option>
              {testRuns.map(run => (
                <option key={run.id} value={run.id}>{run.name} ({run.status})</option>
              ))}
            </select>
        </div>
      </div>

      {/* NAVIGATION */}
      <div className="flex gap-4 mb-6 border-b border-zinc-800 overflow-x-auto">
          {['TEST', 'TRADES', 'PERF', 'CALIBRATION', 'FEES', 'INTEL'].map(tab => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab as any)} 
              className={`pb-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap px-2 flex items-center gap-2 ${activeTab === tab ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-500'}`}
            >
              {tab === 'INTEL' && <BrainCircuit size={14} />}
              {tab}
            </button>
          ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* LEFT COLUMN (Main Content) */}
          <div className="lg:col-span-3 bg-black border border-zinc-800 rounded-lg min-h-[600px] p-4">
            
            {/* TAB: INTEL / NEWS ANALYSIS */}
            {activeTab === 'INTEL' && (
              <div className="space-y-6">
                 <div className="bg-zinc-900/50 p-6 rounded border border-zinc-800">
                    <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-wider">
                        <FileText size={16} className="text-emerald-500" /> Market Intelligence Parser
                    </h2>
                    <p className="text-xs text-zinc-500 mb-4">
                        Paste news articles, tweets, or regulatory filings below. The system will analyze key entities and sentiment to suggest market direction.
                    </p>
                    
                    <textarea 
                        className="w-full h-40 bg-black border border-zinc-700 rounded p-4 text-sm font-mono text-zinc-300 focus:border-emerald-500 outline-none resize-none"
                        placeholder="Paste article text here... (e.g. 'Polymarket faces new regulatory challenges in France...')"
                        value={intelInput}
                        onChange={e => setIntelInput(e.target.value)}
                    />

                    <div className="mt-4 flex justify-end">
                        <button 
                            onClick={handleAnalyzeIntel}
                            disabled={isAnalyzing || !intelInput}
                            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-bold py-2 px-6 rounded text-sm flex items-center gap-2 transition-all"
                        >
                            {isAnalyzing ? <RefreshCw className="animate-spin" size={16} /> : <Search size={16} />}
                            {isAnalyzing ? 'ANALYZING...' : 'RUN SENTIMENT ANALYSIS'}
                        </button>
                    </div>
                 </div>

                 {intelResult && (
                    <div className="grid grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded flex flex-col items-center justify-center">
                            <span className="text-zinc-500 text-xs uppercase mb-2">Sentiment Score</span>
                            <span className={`text-4xl font-bold font-mono ${intelResult.score > 0 ? 'text-emerald-500' : intelResult.score < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                                {intelResult.score > 0 ? '+' : ''}{intelResult.score}
                            </span>
                        </div>
                        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded flex flex-col items-center justify-center">
                            <span className="text-zinc-500 text-xs uppercase mb-2">Strategic Bias</span>
                            <span className={`text-2xl font-bold px-4 py-1 rounded ${
                                intelResult.bias === 'BULLISH' ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 
                                intelResult.bias === 'BEARISH' ? 'bg-red-950 text-red-400 border border-red-900' : 
                                'bg-zinc-800 text-zinc-400'
                            }`}>
                                {intelResult.bias}
                            </span>
                        </div>
                        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded">
                             <span className="text-zinc-500 text-xs uppercase mb-2 block text-center">Key Triggers</span>
                             <div className="flex flex-wrap gap-2 justify-center">
                                 {intelResult.keywords.map(k => (
                                     <span key={k} className="text-xs font-mono bg-zinc-800 px-2 py-1 rounded text-zinc-300">
                                         {k}
                                     </span>
                                 ))}
                                 {intelResult.keywords.length === 0 && <span className="text-xs text-zinc-600 italic">No triggers found</span>}
                             </div>
                        </div>
                    </div>
                 )}
              </div>
            )}

            {/* TAB: TEST RUNS */}
            {activeTab === 'TEST' && (
              <div className="space-y-6">
                
                {/* ONE-CLICK TEST RUNNER */}
                <div className="bg-zinc-900/50 p-6 rounded border border-zinc-800">
                    <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-wider">
                        <FlaskConical size={16} className="text-emerald-500" /> One-Click Test Runner
                    </h2>
                    
                    <div className="grid grid-cols-12 gap-4 items-end">
                        <div className="col-span-3">
                            <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Experiment Name</label>
                            <input 
                                className="w-full bg-black border border-zinc-700 rounded p-2 text-sm focus:border-emerald-500 outline-none"
                                placeholder="e.g. BTC-High-Vol"
                                value={newRunName}
                                onChange={e => setNewRunName(e.target.value)}
                            />
                        </div>
                        <div className="col-span-5">
                            <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Target Market Slug</label>
                            <input 
                                className="w-full bg-black border border-zinc-700 rounded p-2 text-sm font-mono focus:border-emerald-500 outline-none"
                                placeholder="bitcoin-up-or-down-..."
                                value={targetSlug}
                                onChange={e => setTargetSlug(e.target.value)}
                            />
                        </div>
                        <div className="col-span-4 flex gap-2">
                             <button 
                                onClick={handleStartTest}
                                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 rounded text-sm flex items-center justify-center gap-2 transition-all"
                             >
                                <Play size={14} fill="currentColor" /> START TEST
                             </button>
                             {/* Reset Exposure Button embedded here for convenience */}
                             <button 
                                onClick={() => handleResetExposure(targetSlug)}
                                title="Reset Exposure to $0"
                                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-600 p-2 rounded"
                             >
                                <RefreshCw size={18} />
                             </button>
                        </div>
                    </div>
                    <div className="mt-3">
                         <input 
                                className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-zinc-400 focus:border-emerald-500 outline-none"
                                placeholder="Hypothesis (optional)..."
                                value={newRunHypothesis}
                                onChange={e => setNewRunHypothesis(e.target.value)}
                            />
                    </div>
                </div>

                {/* RUN LIST */}
                <div className="space-y-3">
                  {testRuns.map(run => (
                    <div key={run.id} className="bg-zinc-900 border border-zinc-800 p-4 rounded flex justify-between items-center group hover:border-zinc-700 transition-colors">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                              <span className={`w-2 h-2 rounded-full ${run.status === 'RUNNING' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`}></span>
                              <h3 className="text-sm font-bold text-white">{run.name}</h3>
                              <span className="text-[10px] bg-zinc-950 px-2 py-0.5 rounded text-zinc-500 border border-zinc-800">{run.status}</span>
                          </div>
                          <p className="text-xs text-zinc-500 font-mono mb-2">{run.hypothesis}</p>
                          <div className="flex items-center gap-4 text-[10px] text-zinc-600 font-mono">
                              <span>Slug: {run.params?.targetSlug || 'N/A'}</span>
                              <span>Started: {run.start_at ? new Date(run.start_at).toLocaleString() : '-'}</span>
                          </div>
                        </div>
                        
                        <div className="flex flex-col items-end gap-2">
                          {run.status === 'RUNNING' && (
                            <button onClick={() => handleStopTest(run.id)} className="bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-900 text-xs px-3 py-1 rounded flex items-center gap-2">
                              <Square size={12} fill="currentColor" /> STOP TEST
                            </button>
                          )}
                          <div className="text-[10px] text-zinc-600 font-mono">{run.id.split('-')[0]}...</div>
                        </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB: TRADES */}
            {activeTab === 'TRADES' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-zinc-900/50 text-[10px] uppercase text-zinc-500 font-mono sticky top-0">
                      <tr>
                        <th className="p-3">Time</th>
                        <th className="p-3">Asset</th>
                        <th className="p-3">Side</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Conf</th>
                        <th className="p-3 text-right">Edge%</th>
                        <th className="p-3 text-right">EV($)</th>
                        <th className="p-3 text-center">Outcome</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                      {trades.map(trade => (
                        <tr key={trade.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                          <td className="p-3 text-zinc-500">{new Date(trade.created_at).toLocaleTimeString()}</td>
                          <td className="p-3 text-white font-bold">{trade.asset}</td>
                          <td className={`p-3 font-bold ${trade.side === 'UP' ? 'text-emerald-400' : 'text-red-400'}`}>{trade.side}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] ${trade.status === 'EXECUTED' ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-900 text-zinc-500'}`}>
                              {trade.decision_reason}
                            </span>
                          </td>
                          <td className="p-3 text-right">{(trade.confidence * 100).toFixed(0)}%</td>
                          <td className={`p-3 text-right ${trade.edge_after_fees_pct > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {formatPct(trade.edge_after_fees_pct / 100)}
                          </td>
                          <td className="p-3 text-right text-blue-400">{formatUsd(trade.ev_after_fees_usd)}</td>
                          <td className="p-3 text-center">
                            {trade.outcome === 'WIN' && <span className="text-emerald-500 font-bold">WIN</span>}
                            {trade.outcome === 'LOSS' && <span className="text-red-500 font-bold">LOSS</span>}
                            {trade.outcome === 'OPEN' && <span className="text-zinc-600">-</span>}
                          </td>
                          <td className="p-3 text-right">
                            {trade.status === 'EXECUTED' && trade.outcome === 'OPEN' && (
                              <button onClick={() => simulateOutcome(trade)} className="text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-300">
                                Simulate
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                </table>
              </div>
            )}

            {/* TAB: CALIBRATION */}
            {activeTab === 'CALIBRATION' && (
              <div className="p-4">
                <h2 className="text-sm font-bold text-white uppercase mb-6 flex items-center gap-2">
                    <Target size={16} /> Confidence Calibration (Binning)
                </h2>
                <p className="text-xs text-zinc-500 mb-6 max-w-lg">
                  This view buckets trades by their predicted confidence (x-axis) and calculates the actual realized win rate (y-axis). 
                  In a perfectly calibrated model, 70% confidence trades should win 70% of the time.
                </p>
                {renderCalibration()}
              </div>
            )}

            {/* TAB: PERFORMANCE */}
            {activeTab === 'PERF' && (
              <div className="grid grid-cols-3 gap-6">
                  <div className="bg-zinc-900 border border-zinc-800 p-4 rounded">
                    <div className="text-zinc-500 text-[10px] uppercase">Total Executed</div>
                    <div className="text-2xl font-bold text-white">{trades.filter(t => t.status === 'EXECUTED').length}</div>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 p-4 rounded">
                    <div className="text-zinc-500 text-[10px] uppercase">Realized PnL (Simulated)</div>
                    <div className="text-2xl font-bold text-