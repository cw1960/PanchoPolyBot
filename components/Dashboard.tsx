
import React, { useState, useEffect } from 'react';
import { 
  Play, Pause, Square, Save, Activity, Shield, 
  Terminal, BarChart3, Microscope, FastForward, History,
  Settings, Database, FlaskConical, Target, TrendingUp, Filter,
  CheckCircle, XCircle, AlertTriangle, Plus, Clipboard
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
}

interface SimConfig {
  enable_slippage: boolean;
  slippage_bps_mid: number;
}

// --- UTILS ---
const formatPct = (val: number) => `${(val * 100).toFixed(2)}%`;
const formatUsd = (val: number) => `$${val.toFixed(3)}`;

// --- COMPONENT ---

export const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'TRADES' | 'PERF' | 'FEES' | 'TEST' | 'CALIBRATION' | 'SIM'>('TRADES');
  const [feeConfig, setFeeConfig] = useState<FeeConfig | null>(null);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [activeTestRunId, setActiveTestRunId] = useState<string | 'ALL'>('ALL');
  
  // New Run State
  const [newRunName, setNewRunName] = useState("");
  const [newRunHypothesis, setNewRunHypothesis] = useState("");
  const [isCreatingRun, setIsCreatingRun] = useState(false);

  useEffect(() => {
    fetchFeeConfig();
    fetchTestRuns();
    fetchTrades();
    const interval = setInterval(fetchTrades, 5000); 
    return () => clearInterval(interval);
  }, [activeTestRunId]);

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

  const createTestRun = async () => {
    if (!newRunName) return;
    const { data, error } = await supabase.from('test_runs').insert({
      name: newRunName,
      hypothesis: newRunHypothesis,
      status: 'PLANNED',
      params: { strategy: 'MOMENTUM_V1', max_exposure: 50 }
    }).select();

    if (data) {
      setTestRuns([data[0], ...testRuns]);
      setIsCreatingRun(false);
      setNewRunName("");
    }
  };

  const startRun = async (id: string) => {
    await supabase.from('test_runs').update({ status: 'RUNNING', start_at: new Date().toISOString() }).eq('id', id);
    fetchTestRuns();
  };

  const completeRun = async (id: string) => {
    await supabase.from('test_runs').update({ status: 'COMPLETED', end_at: new Date().toISOString() }).eq('id', id);
    fetchTestRuns();
  };

  const simulateOutcome = async (trade: TradeEvent) => {
    // Simple 15m expiration check logic (Client-side simulation)
    const expiryTime = new Date(new Date(trade.created_at).getTime() + 15 * 60000);
    if (new Date() < expiryTime) {
      alert("Trade has not expired yet (15m rule)");
      return;
    }

    // Heuristic: If we don't have historical data API, we simulate 50/50 for demo or check current if recent
    // In a real app, we'd query Binance for the candle at `expiryTime`.
    const simulatedOutcome = Math.random() > 0.45 ? 'WIN' : 'LOSS'; // Slight bias for testing
    const pnl = simulatedOutcome === 'WIN' ? trade.stake_usd : -trade.stake_usd;

    await supabase.from('trade_events').update({
      outcome: simulatedOutcome,
      realized_pnl_usd: pnl,
      status: 'SETTLED'
    }).eq('id', trade.id);
    fetchTrades();
  };

  // --- CALIBRATION LOGIC ---
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
            ARBINTEL LABS <span className="text-zinc-600 text-sm px-2 py-0.5 border border-zinc-800 rounded">v3.0 (EMPIRICAL)</span>
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
          {['TEST', 'TRADES', 'PERF', 'CALIBRATION', 'FEES'].map(tab => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab as any)} 
              className={`pb-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap px-2 ${activeTab === tab ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-500'}`}
            >
              {tab}
            </button>
          ))}
      </div>

      {/* CONTENT */}
      <div className="bg-black border border-zinc-800 rounded-lg min-h-[600px] p-4">
        
        {/* TAB: TEST RUNS */}
        {activeTab === 'TEST' && (
          <div className="space-y-6">
             {/* CREATION FORM */}
             <div className="bg-zinc-900/30 p-4 rounded border border-zinc-800">
                <div className="flex justify-between items-center mb-4">
                   <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      <FlaskConical size={16} /> Experiment Management
                   </h2>
                   <button onClick={() => setIsCreatingRun(!isCreatingRun)} className="bg-zinc-800 hover:bg-zinc-700 text-xs px-3 py-1 rounded flex items-center gap-2">
                      <Plus size={12} /> New Experiment
                   </button>
                </div>
                
                {isCreatingRun && (
                  <div className="grid gap-4 mb-4 animate-in fade-in slide-in-from-top-2">
                    <input 
                      placeholder="Experiment Name (e.g. Momentum-V2-BTC)" 
                      className="bg-black border border-zinc-700 p-2 text-sm rounded"
                      value={newRunName}
                      onChange={e => setNewRunName(e.target.value)}
                    />
                    <textarea 
                      placeholder="Hypothesis..." 
                      className="bg-black border border-zinc-700 p-2 text-sm rounded h-20"
                      value={newRunHypothesis}
                      onChange={e => setNewRunHypothesis(e.target.value)}
                    />
                    <button onClick={createTestRun} className="bg-emerald-600 text-white font-bold py-2 rounded text-sm">
                      Initialize Run
                    </button>
                  </div>
                )}
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
                          <span>Start: {run.start_at ? new Date(run.start_at).toLocaleString() : '-'}</span>
                          <span>Trades: {trades.filter(t => t.test_run_id === run.id).length}</span>
                       </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-2">
                       {run.status === 'PLANNED' && (
                         <button onClick={() => startRun(run.id)} className="bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900 border border-emerald-900 text-xs px-3 py-1 rounded flex items-center gap-2">
                           <Play size={12} /> Start
                         </button>
                       )}
                       {run.status === 'RUNNING' && (
                         <div className="flex gap-2">
                            <button className="bg-zinc-800 text-zinc-400 text-xs px-3 py-1 rounded flex items-center gap-2" 
                              onClick={() => navigator.clipboard.writeText(`BOT_TEST_RUN_ID=${run.id}`)}>
                              <Clipboard size={12} /> Copy ID
                            </button>
                            <button onClick={() => completeRun(run.id)} className="bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-900 text-xs px-3 py-1 rounded flex items-center gap-2">
                              <Square size={12} /> Finish
                            </button>
                         </div>
                       )}
                       {run.status === 'RUNNING' && (
                          <div className="text-[10px] text-zinc-500">ID: {run.id.split('-')[0]}...</div>
                       )}
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
                 <div className="text-2xl font-bold text-emerald-400">
                    {formatUsd(trades.reduce((sum, t) => sum + (t.realized_pnl_usd || 0), 0))}
                 </div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded">
                 <div className="text-zinc-500 text-[10px] uppercase">Avg Edge (After Fees)</div>
                 <div className="text-2xl font-bold text-blue-400">
                    {formatPct(trades.reduce((sum, t) => sum + (t.edge_after_fees_pct || 0), 0) / trades.length / 100)}
                 </div>
              </div>
           </div>
        )}
      </div>
    </div>
  );
};
