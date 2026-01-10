import React, { useState, useEffect } from 'react';
import { 
  Play, Pause, Square, Save, Activity, Shield, 
  Terminal, BarChart3, Microscope, FastForward, History,
  Settings, Database, FlaskConical, Target, TrendingUp, Filter,
  CheckCircle, XCircle, AlertTriangle, Plus, Clipboard, Power, RefreshCw,
  BrainCircuit, FileText, Search, ArrowRight, Download, RefreshCcw, Info, Trash2, Edit2
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
  params: {
    targetSlug: string;
    direction: 'UP' | 'DOWN' | 'BOTH';
    tradeSize: number;
    maxExposure: number;
    confidenceThreshold: number;
    cooldown: number;
  };
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

interface ExperimentConfig {
  direction: 'UP' | 'DOWN' | 'BOTH';
  tradeSize: number;
  maxExposure: number;
  confidence: number;
  cooldown: number;
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
  const [enabledMarkets, setEnabledMarkets] = useState<any[]>([]);
  
  // New Run State
  const [newRunName, setNewRunName] = useState("");
  const [newRunHypothesis, setNewRunHypothesis] = useState("");
  const [targetSlug, setTargetSlug] = useState("");
  const [expConfig, setExpConfig] = useState<ExperimentConfig>({
    direction: 'BOTH',
    tradeSize: 5,
    maxExposure: 100,
    confidence: 0.60,
    cooldown: 5000
  });

  // Bot Status
  const [botHeartbeat, setBotHeartbeat] = useState<BotHeartbeat | null>(null);
  const [desiredState, setDesiredState] = useState<'running'|'stopped'>('stopped');

  // Intel State
  const [intelInput, setIntelInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [intelResult, setIntelResult] = useState<{ score: number, bias: string, keywords: string[] } | null>(null);
  const [isSavingFees, setIsSavingFees] = useState(false);


  useEffect(() => {
    fetchFeeConfig();
    fetchTestRuns();
    fetchTrades();
    fetchBotStatus();
    fetchEnabledMarkets();
    
    const interval = setInterval(() => {
        fetchTrades();
        fetchBotStatus();
        fetchEnabledMarkets();
    }, 5000); 
    return () => clearInterval(interval);
  }, [activeTestRunId]);

  const fetchBotStatus = async () => {
      const { data: heartbeat } = await supabase.from('bot_heartbeats').select('*').limit(1).single();
      if (heartbeat) setBotHeartbeat(heartbeat);

      const { data: control } = await supabase.from('bot_control').select('desired_state').single();
      if (control) setDesiredState(control.desired_state);
  }

  const fetchEnabledMarkets = async () => {
    // Fetches baseline_price now for display
    const { data } = await supabase.from('markets').select('*').eq('enabled', true);
    if (data) setEnabledMarkets(data);
  };

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
    const { data, error } = await query;
    if (error) {
        console.error("Error fetching trades:", error);
    }
    if (data) setTrades(data);
  };

  // --- ACTIONS ---

  const handleStartTest = async () => {
      if (!newRunName || !targetSlug) {
          alert("Please enter both a Run Name and a Market Slug.");
          return;
      }

      // 1. Create Run with Experiment Params
      const { data: runData, error } = await supabase.from('test_runs').insert({
        name: newRunName,
        hypothesis: newRunHypothesis || 'Automated UI Test',
        status: 'RUNNING',
        start_at: new Date().toISOString(),
        params: { 
            targetSlug,
            direction: expConfig.direction,
            tradeSize: expConfig.tradeSize,
            maxExposure: expConfig.maxExposure,
            confidenceThreshold: expConfig.confidence,
            cooldown: expConfig.cooldown
        }
      }).select().single();

      if (error || !runData) {
          alert("Failed to create test run");
          return;
      }

      // 2. Configure Market (Enable & Link)
      let { data: marketData, error: fetchError } = await supabase
        .from('markets')
        .select('id')
        .eq('polymarket_market_id', targetSlug)
        .maybeSingle();

      if (fetchError) {
          alert("DB Error: " + fetchError.message);
          return;
      }
      
      if (!marketData) {
          // Create new market entry if it doesn't exist
          const { data: newMarket, error: insertError } = await supabase.from('markets').insert({
              polymarket_market_id: targetSlug,
              asset: 'BTC', // Default fallback
              enabled: true,
              active_run_id: runData.id,
              direction: 'UP',
              max_exposure: expConfig.maxExposure
          }).select('id').single();
          
          if (insertError || !newMarket) {
             alert("Failed to create market record: " + insertError?.message);
             return;
          }
          marketData = newMarket;
      } else {
          // Update existing market
          await supabase.from('markets').update({
              enabled: true,
              active_run_id: runData.id,
              max_exposure: expConfig.maxExposure
          }).eq('id', marketData.id);
      }

      // 3. CRITICAL: Reset Exposure State for Clean Experiment
      if (marketData) {
          await supabase.from('market_state').update({ 
              exposure: 0,
              status: 'WATCHING',
              last_update: new Date().toISOString()
           }).eq('market_id', marketData.id);
      }

      // 4. Start Bot
      await supabase.from('bot_control').update({ desired_state: 'running' }).eq('id', 1);

      // UI Reset
      setNewRunName("");
      setNewRunHypothesis("");
      fetchTestRuns();
      fetchBotStatus();
      fetchEnabledMarkets();
      alert(`Experiment "${runData.name}" Started! Used Budget reset to $0. (Bot has $${expConfig.maxExposure} available to spend).`);
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
      fetchEnabledMarkets();
  };
  
  const handleKillMarket = async (id: string) => {
      const { error } = await supabase.from('markets').update({ enabled: false }).eq('id', id);
      if (!error) {
          fetchEnabledMarkets();
          alert("Market Disabled. Bot will remove it on next tick.");
      } else {
          alert("Error disabling market: " + error.message);
      }
  };
  
  const handleManualBaseline = async (marketId: string, currentVal: number | null) => {
      const val = prompt("Enter Manual Baseline Price (Warning: Overrides Bot Data)", currentVal ? currentVal.toString() : "");
      if (val) {
          const num = parseFloat(val);
          if (!isNaN(num)) {
              await supabase.from('markets').update({ baseline_price: num }).eq('id', marketId);
              fetchEnabledMarkets();
              alert("Baseline Price Updated. Bot should pick this up on next tick.");
          }
      }
  };

  const handleStopAllMarkets = async () => {
      if(!confirm("ARE YOU SURE? This will disable ALL markets in the database.")) return;
      
      const { error } = await supabase.from('markets').update({ enabled: false });
      if (error) {
          alert("Failed to stop markets: " + error.message);
      } else {
          fetchEnabledMarkets();
          alert("All markets disabled. Bot should idle shortly.");
      }
  };

  const handleResetExposure = async (marketSlug: string) => {
      if (!marketSlug) {
          alert("Please enter a Market Slug to reset.");
          return;
      }
      
      // 1. Try to find the market
      let { data: m } = await supabase
        .from('markets')
        .select('id')
        .eq('polymarket_market_id', marketSlug)
        .maybeSingle();
        
      // 2. If not found, create it (lazily) so we can attach state
      if (!m) {
          const { data: newM, error: createErr } = await supabase.from('markets').insert({
              polymarket_market_id: marketSlug,
              asset: 'BTC', // Default fallback
              enabled: false,
              direction: 'UP',
              max_exposure: 100
          }).select('id').single();
          
          if (createErr || !newM) {
              alert("Error creating market record: " + createErr?.message);
              return;
          }
          m = newM;
      }
      
      // 3. Perform the Reset
      if (m) {
          await supabase.from('market_state').update({ 
              exposure: 0,
              last_update: new Date().toISOString()
          }).eq('market_id', m.id);
          
          alert(`Used Budget reset to $0. The bot is now allowed to trade up to its Max Budget for ${marketSlug}.`);
      }
  };

  const handleSaveFeeConfig = async () => {
    if (!feeConfig) return;
    setIsSavingFees(true);
    const { error } = await supabase.from('fee_config').update({
        buy_fee_peak_pct: feeConfig.buy_fee_peak_pct,
        buy_fee_peak_at_prob: feeConfig.buy_fee_peak_at_prob,
        sell_fee_peak_pct: feeConfig.sell_fee_peak_pct,
        sell_fee_peak_at_prob: feeConfig.sell_fee_peak_at_prob,
        min_fee_pct: feeConfig.min_fee_pct,
        shape_exponent: feeConfig.shape_exponent
    }).eq('id', feeConfig.id);
    
    setIsSavingFees(false);
    if (error) alert("Failed to save fee config: " + error.message);
  };

  const handleForceSync = async () => {
      // Updates the timestamp on bot_control to trigger a wake-up in the bot's loop
      const { error } = await supabase.from('bot_control').update({ updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) alert("Failed to send sync signal");
      else alert("Sync signal sent to bot network.");
  };

  const handleExportLogs = () => {
    if (trades.length === 0) {
        alert("No trades to export.");
        return;
    }
    const headers = ['Time', 'Asset', 'Side', 'Status', 'Confidence', 'EV($)', 'PnL($)'];
    const rows = trades.map(t => [
        t.created_at, 
        t.asset, 
        t.side, 
        t.status, 
        t.confidence, 
        t.ev_after_fees_usd, 
        t.realized_pnl_usd
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
        + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `trade_logs_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
          <div className="bg-zinc-900 border border-zinc-800 rounded p-4 flex items-center justify-between shadow-lg">
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
              
              <div className="flex flex-col items-end">
                  <div className="text-xs text-zinc-500 uppercase mb-1">Active Engines</div>
                  <div className="text-2xl font-mono font-bold text-white mb-2">{enabledMarkets.length}</div>
                  
                  <div className="space-y-2 w-full flex flex-col items-end">
                      {enabledMarkets.map(m => (
                          <div key={m.id} className="w-full bg-zinc-950/50 p-2 rounded border border-zinc-800 flex flex-col gap-2">
                              <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-emerald-500 font-mono font-bold">
                                      {m.asset || 'UNK'}
                                  </span>
                                  <button 
                                      onClick={() => handleKillMarket(m.id)}
                                      className="text-zinc-600 hover:text-red-500 transition-colors"
                                      title="Force Disable Market"
                                  >
                                      <XCircle size={12} />
                                  </button>
                              </div>
                              <div className="flex justify-between items-center bg-zinc-900/50 p-1 rounded">
                                   {m.baseline_price ? (
                                       <span className="text-[10px] text-zinc-400 font-mono">
                                          Ref: ${m.baseline_price.toFixed(2)}
                                       </span>
                                   ) : (
                                       <button 
                                          onClick={() => handleManualBaseline(m.id, null)}
                                          className="text-[10px] bg-red-900/20 text-red-400 border border-red-900/50 px-2 py-0.5 rounded hover:bg-red-900/40 animate-pulse"
                                       >
                                          MISSING BASELINE
                                       </button>
                                   )}
                                   {m.baseline_price && (
                                       <button onClick={() => handleManualBaseline(m.id, m.baseline_price)}>
                                          <Edit2 size={10} className="text-zinc-600 hover:text-white" />
                                       </button>
                                   )}
                              </div>
                          </div>
                      ))}
                  </div>
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
          <div key={stat.binLow} className="bg-zinc-900 border border-zinc-800 p-4 rounded text-center hover:border-zinc-700 transition-colors">
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
              className="bg-zinc-900 border border-zinc-800 text-xs rounded p-2 text-white outline-none focus:border-emerald-500 transition-colors"
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
              className={`pb-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap px-2 flex items-center gap-2 ${activeTab === tab ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
            >
              {tab === 'INTEL' && <BrainCircuit size={14} />}
              {tab}
            </button>
          ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* LEFT COLUMN (Main Content) */}
          <div className="lg:col-span-3 bg-black border border-zinc-800 rounded-lg min-h-[600px] p-4 shadow-xl">
            
            {/* TAB: INTEL / NEWS ANALYSIS */}
            {activeTab === 'INTEL' && (
              <div className="space-y-6">
                 {/* ... INTEL CONTENT UNCHANGED ... */}
                 <div className="bg-zinc-900/50 p-6 rounded border border-zinc-800">
                    <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-wider">
                        <FileText size={16} className="text-emerald-500" /> Market Intelligence Parser
                    </h2>
                    <textarea 
                        className="w-full h-40 bg-black border border-zinc-700 rounded p-4 text-sm font-mono text-zinc-300 focus:border-emerald-500 outline-none resize-none transition-colors"
                        placeholder="Paste article text here..."
                        value={intelInput}
                        onChange={e => setIntelInput(e.target.value)}
                    />
                    <div className="mt-4 flex justify-end">
                        <button 
                            onClick={handleAnalyzeIntel}
                            disabled={isAnalyzing || !intelInput}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-6 rounded text-sm flex items-center gap-2 transition-all disabled:opacity-50"
                        >
                            {isAnalyzing ? <RefreshCw className="animate-spin" size={16} /> : 'RUN ANALYSIS'}
                        </button>
                    </div>
                 </div>
                 {/* INTEL RESULTS */}
                 {intelResult && (
                    <div className="grid grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded text-center">
                            <span className="text-zinc-500 text-xs uppercase mb-2">Score</span>
                            <div className="text-2xl font-bold">{intelResult.score}</div>
                        </div>
                        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded text-center">
                            <span className="text-zinc-500 text-xs uppercase mb-2">Bias</span>
                            <div className={`text-2xl font-bold ${intelResult.bias === 'BULLISH' ? 'text-emerald-500' : intelResult.bias === 'BEARISH' ? 'text-red-500' : 'text-zinc-300'}`}>
                                {intelResult.bias}
                            </div>
                        </div>
                        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded text-center">
                            <span className="text-zinc-500 text-xs uppercase mb-2">Keywords</span>
                            <div className="text-xs text-zinc-400 mt-1 flex flex-wrap gap-1 justify-center">
                                {intelResult.keywords.map(k => (
                                    <span key={k} className="bg-zinc-800 px-1 rounded">{k}</span>
                                ))}
                            </div>
                        </div>
                    </div>
                 )}
              </div>
            )}

            {/* TAB: TEST RUNS */}
            {activeTab === 'TEST' && (
              <div className="space-y-6">
                
                {/* EXPERIMENT CONTROL PLANE */}
                <div className="bg-zinc-900/50 p-6 rounded border border-zinc-800 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity duration-700">
                        <FlaskConical size={120} />
                    </div>

                    <h2 className="text-sm font-bold text-white mb-6 flex items-center gap-2 uppercase tracking-wider relative z-10">
                        <FlaskConical size={16} className="text-emerald-500" /> Experiment Control Plane
                    </h2>
                    
                    <div className="grid grid-cols-12 gap-6 relative z-10">
                        
                        {/* 1. Identity */}
                        <div className="col-span-12 lg:col-span-8 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Experiment Name</label>
                                    <input 
                                        className="w-full bg-black border border-zinc-700 rounded p-2 text-sm focus:border-emerald-500 outline-none transition-colors"
                                        placeholder="e.g. BTC-Vol-Test-1"
                                        value={newRunName}
                                        onChange={e => setNewRunName(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Market Slug</label>
                                    <input 
                                        className="w-full bg-black border border-zinc-700 rounded p-2 text-sm font-mono focus:border-emerald-500 outline-none transition-colors"
                                        placeholder="bitcoin-up-or-down-..."
                                        value={targetSlug}
                                        onChange={e => setTargetSlug(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div>
                                <input 
                                    className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-zinc-400 focus:border-emerald-500 outline-none transition-colors"
                                    placeholder="Hypothesis (e.g. 'Higher confidence threshold reduces loss rate')"
                                    value={newRunHypothesis}
                                    onChange={e => setNewRunHypothesis(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* 2. Parameters */}
                        <div className="col-span-12 lg:col-span-4 space-y-3 bg-black/40 p-4 rounded border border-zinc-800/50">
                            <label className="text-[10px] text-emerald-500 uppercase font-bold block mb-2 border-b border-zinc-800 pb-1">Run Configuration</label>
                            
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-zinc-400 font-bold">Direction</span>
                                <div className="flex bg-zinc-900 rounded p-0.5 border border-zinc-700">
                                    {(['UP', 'BOTH', 'DOWN'] as const).map(d => (
                                        <button 
                                            key={d}
                                            onClick={() => setExpConfig(c => ({...c, direction: d}))}
                                            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${expConfig.direction === d ? 'bg-zinc-700 text-white font-bold' : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            {d}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                                <span className="text-xs text-zinc-400 font-bold">Trade Size</span>
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-zinc-600">$</span>
                                    <input 
                                        type="number" 
                                        className="w-16 bg-zinc-900 border border-zinc-700 rounded text-right px-2 py-0.5 text-xs text-white focus:border-emerald-500 outline-none"
                                        value={expConfig.tradeSize}
                                        onChange={e => setExpConfig(c => ({...c, tradeSize: parseFloat(e.target.value)}))}
                                    />
                                </div>
                            </div>

                            <div className="flex justify-between items-center group relative">
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-zinc-400 font-bold">Max Budget ($)</span>
                                  <Info size={10} className="text-zinc-600" />
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-zinc-600">$</span>
                                    <input 
                                        type="number" 
                                        className="w-16 bg-zinc-900 border border-zinc-700 rounded text-right px-2 py-0.5 text-xs text-white focus:border-emerald-500 outline-none"
                                        value={expConfig.maxExposure}
                                        onChange={e => setExpConfig(c => ({...c, maxExposure: parseFloat(e.target.value)}))}
                                    />
                                </div>
                                {/* Tooltip */}
                                <div className="absolute bottom-full left-0 mb-2 w-48 bg-black border border-zinc-700 p-2 rounded text-[10px] text-zinc-400 hidden group-hover:block z-50 shadow-lg">
                                  Total amount the bot is allowed to spend. The bot stops trading when Used &gt;= Max.
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                                <span className="text-xs text-zinc-400 font-bold">Conf. Threshold</span>
                                <input 
                                    type="number" step="0.05"
                                    className="w-16 bg-zinc-900 border border-zinc-700 rounded text-right px-2 py-0.5 text-xs text-white focus:border-emerald-500 outline-none"
                                    value={expConfig.confidence}
                                    onChange={e => setExpConfig(c => ({...c, confidence: parseFloat(e.target.value)}))}
                                />
                            </div>
                        </div>

                    </div>
                    
                    {/* Action Bar */}
                    <div className="mt-6 pt-4 border-t border-zinc-800 flex justify-end gap-3 items-center">
                         <span className="text-[10px] text-zinc-600 mr-2">
                           Starting Usage: $0 (Full ${expConfig.maxExposure} Available)
                         </span>
                         <button 
                            onClick={() => handleResetExposure(targetSlug)}
                            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 px-4 py-2 rounded text-xs font-bold transition-colors flex items-center gap-2 border border-zinc-700"
                            title="Sets 'Used Budget' to $0, allowing the bot to trade again."
                         >
                            <RefreshCcw size={12} /> RESET 'USED' BUDGET ($0)
                         </button>
                         <button 
                            onClick={handleStartTest}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-2 rounded text-sm font-bold flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] transition-all"
                         >
                            <Play size={16} fill="currentColor" /> INITIATE EXPERIMENT
                         </button>
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
                              <span className={`text-[10px] px-2 py-0.5 rounded border ${run.status === 'RUNNING' ? 'bg-emerald-950 text-emerald-400 border-emerald-900' : 'bg-zinc-950 text-zinc-500 border-zinc-800'}`}>{run.status}</span>
                          </div>
                          <p className="text-xs text-zinc-500 font-mono mb-2">{run.hypothesis}</p>
                          <div className="flex items-center gap-4 text-[10px] text-zinc-600 font-mono">
                              <span>Slug: {run.params?.targetSlug?.substring(0, 20) || 'N/A'}...</span>
                              <span>Mode: {run.params?.direction || 'BOTH'}</span>
                              <span className="text-zinc-400">Budget Limit: ${run.params?.maxExposure}</span>
                          </div>
                        </div>
                        
                        <div className="flex flex-col items-end gap-2">
                          {run.status === 'RUNNING' && (
                            <button onClick={() => handleStopTest(run.id)} className="bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-900 text-xs px-3 py-1 rounded flex items-center gap-2 transition-colors">
                              <Square size={12} fill="currentColor" /> ABORT EXPERIMENT
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
                        <tr key={trade.id} className="border-b border-zinc-900 hover:bg-zinc-900/30 transition-colors">
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
                    <div className={`text-2xl font-bold ${trades.reduce((acc, t) => acc + (t.realized_pnl_usd || 0), 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {formatUsd(trades.reduce((acc, t) => acc + (t.realized_pnl_usd || 0), 0))}
                    </div>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 p-4 rounded">
                    <div className="text-zinc-500 text-[10px] uppercase">Win Rate (Simulated)</div>
                    <div className="text-2xl font-bold text-blue-400">
                        {(() => {
                            const settled = trades.filter(t => t.outcome === 'WIN' || t.outcome === 'LOSS');
                            if (settled.length === 0) return '0%';
                            const wins = settled.filter(t => t.outcome === 'WIN').length;
                            return ((wins / settled.length) * 100).toFixed(1) + '%';
                        })()}
                    </div>
                  </div>
              </div>
            )}

            {/* TAB: FEES */}
            {activeTab === 'FEES' && feeConfig && (
                <div className="space-y-6">
                    <div className="bg-zinc-900/50 p-6 rounded border border-zinc-800">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                                <TrendingUp size={16} className="text-emerald-500" /> Fee Curve Configuration
                            </h2>
                            {isSavingFees && <span className="text-xs text-emerald-500 animate-pulse">Saving...</span>}
                        </div>

                        <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold text-zinc-500 uppercase border-b border-zinc-800 pb-2">Buy Side Config</h3>
                                <div>
                                    <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1">Peak Fee %</label>
                                    <input 
                                        type="number" step="0.001"
                                        className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none"
                                        value={feeConfig.buy_fee_peak_pct}
                                        onChange={(e) => setFeeConfig({...feeConfig, buy_fee_peak_pct: parseFloat(e.target.value)})}
                                    />
                                    <p className="text-[10px] text-zinc-600 mt-1">Max fee at peak uncertainty (0.50)</p>
                                </div>
                                <div>
                                    <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1">Peak At Prob.</label>
                                    <input 
                                        type="number" step="0.05"
                                        className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none"
                                        value={feeConfig.buy_fee_peak_at_prob}
                                        onChange={(e) => setFeeConfig({...feeConfig, buy_fee_peak_at_prob: parseFloat(e.target.value)})}
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-xs font-bold text-zinc-500 uppercase border-b border-zinc-800 pb-2">Sell Side Config</h3>
                                <div>
                                    <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1">Peak Fee %</label>
                                    <input 
                                        type="number" step="0.001"
                                        className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none"
                                        value={feeConfig.sell_fee_peak_pct}
                                        onChange={(e) => setFeeConfig({...feeConfig, sell_fee_peak_pct: parseFloat(e.target.value)})}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1">Peak At Prob.</label>
                                    <input 
                                        type="number" step="0.05"
                                        className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none"
                                        value={feeConfig.sell_fee_peak_at_prob}
                                        onChange={(e) => setFeeConfig({...feeConfig, sell_fee_peak_at_prob: parseFloat(e.target.value)})}
                                    />
                                </div>
                            </div>
                            
                             <div className="col-span-2 space-y-4 pt-4 border-t border-zinc-800">
                                <h3 className="text-xs font-bold text-zinc-500 uppercase border-b border-zinc-800 pb-2">Global Curve Shape</h3>
                                <div className="grid grid-cols-2 gap-8">
                                    <div>
                                        <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1">Min Floor Fee %</label>
                                        <input 
                                            type="number" step="0.001"
                                            className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none"
                                            value={feeConfig.min_fee_pct}
                                            onChange={(e) => setFeeConfig({...feeConfig, min_fee_pct: parseFloat(e.target.value)})}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1">Curve Exponent</label>
                                        <input 
                                            type="number" step="0.1"
                                            className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none"
                                            value={feeConfig.shape_exponent}
                                            onChange={(e) => setFeeConfig({...feeConfig, shape_exponent: parseFloat(e.target.value)})}
                                        />
                                        <p className="text-[10px] text-zinc-600 mt-1">Higher = Steeper curve (fewer fees away from peak)</p>
                                    </div>
                                </div>
                             </div>
                        </div>

                        <div className="mt-8 flex justify-end">
                            <button 
                                onClick={handleSaveFeeConfig}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded text-sm font-bold flex items-center gap-2 shadow-lg transition-all"
                            >
                                <Save size={16} /> SAVE CONFIGURATION
                            </button>
                        </div>
                    </div>
                </div>
            )}
          </div>

          {/* RIGHT COLUMN (Sidebar Stats) */}
          <div className="space-y-6">
              {renderBotStatus()}
              
              <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
                  <h3 className="text-xs font-bold text-zinc-500 uppercase mb-3">System Health</h3>
                  <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                          <span className="text-zinc-400">Database</span>
                          <span className="text-emerald-500">Connected</span>
                      </div>
                      <div className="flex justify-between text-xs">
                          <span className="text-zinc-400">Latency</span>
                          <span className="text-zinc-300">24ms</span>
                      </div>
                      <div className="flex justify-between text-xs">
                          <span className="text-zinc-400">Memory</span>
                          <span className="text-zinc-300">42%</span>
                      </div>
                  </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
                 <h3 className="text-xs font-bold text-zinc-500 uppercase mb-3 text-red-500">Danger Zone</h3>
                 <div className="space-y-2">
                    <button 
                        onClick={handleStopAllMarkets}
                        className="w-full text-left text-xs bg-red-950/20 hover:bg-red-950/40 p-2 rounded border border-red-900/50 text-red-400 transition-colors flex items-center gap-2"
                    >
                        <Trash2 size={12} /> STOP ALL MARKETS
                    </button>
                 </div>
                 
                 <h3 className="text-xs font-bold text-zinc-500 uppercase mb-3 mt-6">Quick Actions</h3>
                 <div className="space-y-2">
                    <button 
                        onClick={handleForceSync}
                        className="w-full text-left text-xs bg-zinc-950 hover:bg-zinc-800 p-2 rounded border border-zinc-800 text-zinc-300 transition-colors flex items-center gap-2"
                    >
                        <RefreshCcw size={12} /> Force Sync Markets
                    </button>
                    <button 
                        onClick={handleExportLogs}
                        className="w-full text-left text-xs bg-zinc-950 hover:bg-zinc-800 p-2 rounded border border-zinc-800 text-zinc-300 transition-colors flex items-center gap-2"
                    >
                        <Download size={12} /> Export Trade Logs
                    </button>
                 </div>
              </div>
          </div>

      </div>
    </div>
  );
};