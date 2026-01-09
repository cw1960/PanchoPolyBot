
import React, { useState, useEffect } from 'react';
import { 
  Play, Pause, Square, Save, Activity, Shield, 
  Terminal, BarChart3, Microscope, FastForward, History,
  Settings, Database, FlaskConical, Target, TrendingUp, Filter
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// --- SUPABASE CLIENT (In-Component for Demo, typically separate) ---
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

interface TradeEvent {
  id: string;
  created_at: string;
  market_id: string;
  mode: 'DRY_RUN' | 'LIVE';
  side: string;
  stake_usd: number;
  entry_prob: number;
  confidence: number;
  buy_fee_pct: number;
  edge_after_fees_pct: number;
  ev_after_fees_usd: number;
  decision_reason: string;
  status: string;
  outcome: string;
}

// --- UTILS ---

const formatPct = (val: number) => `${(val * 100).toFixed(2)}%`;
const formatUsd = (val: number) => `$${val.toFixed(3)}`;

// --- COMPONENTS ---

export const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'TRADES' | 'PERF' | 'FEES' | 'TEST'>('TRADES');
  const [feeConfig, setFeeConfig] = useState<FeeConfig | null>(null);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Test Run State
  const [testRunName, setTestRunName] = useState("Experiment-Alpha-1");
  const [isTestActive, setIsTestActive] = useState(false);

  // Calibration Toggle
  const [useCalibratedConfidence, setUseCalibratedConfidence] = useState(false);

  useEffect(() => {
    fetchFeeConfig();
    fetchTrades();
    const interval = setInterval(fetchTrades, 5000); // Poll trades
    return () => clearInterval(interval);
  }, []);

  const fetchFeeConfig = async () => {
    const { data } = await supabase.from('fee_config').select('*').single();
    if (data) setFeeConfig(data);
  };

  const fetchTrades = async () => {
    const { data } = await supabase
      .from('trade_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setTrades(data);
  };

  const updateFeeConfig = async (key: keyof FeeConfig, val: number) => {
    if (!feeConfig) return;
    const newConfig = { ...feeConfig, [key]: val };
    setFeeConfig(newConfig);
    await supabase.from('fee_config').update({ [key]: val }).eq('id', 1);
  };

  // --- CALIBRATION LOGIC (Mocked for Demo) ---
  const getCalibratedConfidence = (rawConf: number) => {
    // Simple mock calibration: aggressive discount on high confidence
    if (rawConf > 0.9) return rawConf * 0.85;
    if (rawConf > 0.7) return rawConf * 0.9;
    return rawConf;
  };

  // --- RENDERERS ---

  const renderFeeCurve = () => {
    if (!feeConfig) return null;
    // Generate data points for SVG
    const pointsBuy: string[] = [];
    const pointsSell: string[] = [];
    const width = 300;
    const height = 100;
    
    for (let i = 0; i <= 100; i++) {
        const prob = i / 100;
        const x = (i / 100) * width;
        
        // Parametric logic duplicated from backend for visualization
        const calcFee = (peak: number, peakAt: number) => {
            const dist = Math.abs(prob - peakAt);
            const norm = Math.min(1, dist / 0.5);
            const factor = 1 - Math.pow(norm, feeConfig.shape_exponent);
            const fee = feeConfig.min_fee_pct + (peak - feeConfig.min_fee_pct) * factor;
            return Math.max(feeConfig.min_fee_pct, Math.min(peak, fee));
        };

        const yBuy = height - (calcFee(feeConfig.buy_fee_peak_pct, feeConfig.buy_fee_peak_at_prob) * 1000); // Scale up
        pointsBuy.push(`${x},${yBuy}`);

        const ySell = height - (calcFee(feeConfig.sell_fee_peak_pct, feeConfig.sell_fee_peak_at_prob) * 1000); 
        pointsSell.push(`${x},${ySell}`);
    }

    return (
        <div className="bg-zinc-900 border border-zinc-800 rounded p-4 mb-4">
            <h3 className="text-xs font-bold text-zinc-500 uppercase mb-2">Fee Model Curve (Est. Fee % vs Probability)</h3>
            <svg width="100%" height={height} className="overflow-visible">
                <path d={`M ${pointsBuy.join(' L ')}`} fill="none" stroke="#10b981" strokeWidth="2" />
                <path d={`M ${pointsSell.join(' L ')}`} fill="none" stroke="#f59e0b" strokeWidth="2" />
                {/* Labels */}
                <text x="5" y="10" fill="#10b981" fontSize="10">BUY FEE</text>
                <text x="5" y="25" fill="#f59e0b" fontSize="10">SELL FEE</text>
            </svg>
            <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                <span>0.0 (0%)</span>
                <span>0.5 (50%)</span>
                <span>1.0 (100%)</span>
            </div>
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
            ARBINTEL LABS <span className="text-zinc-600 text-sm px-2 py-0.5 border border-zinc-800 rounded">v2.1 (FEE-AWARE)</span>
          </h1>
          <p className="text-zinc-500 text-sm mt-1 font-mono">
            Empirical Trading Research • Fee Modeling • Edge Analysis
          </p>
        </div>
        
        {/* Test Window Control */}
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-2 rounded">
             <div className={`w-3 h-3 rounded-full ${isTestActive ? 'bg-emerald-500 animate-pulse' : 'bg-red-900'}`}></div>
             <span className="text-xs font-mono font-bold">{isTestActive ? `TEST RUNNING: ${testRunName}` : "NO ACTIVE TEST"}</span>
             {!isTestActive ? (
                 <button onClick={() => setIsTestActive(true)} className="ml-2 bg-emerald-700 hover:bg-emerald-600 text-white text-[10px] px-2 py-1 rounded">START</button>
             ) : (
                 <button onClick={() => setIsTestActive(false)} className="ml-2 bg-red-700 hover:bg-red-600 text-white text-[10px] px-2 py-1 rounded">STOP</button>
             )}
        </div>
      </div>

      {/* NAVIGATION */}
      <div className="flex gap-4 mb-6 border-b border-zinc-800">
          <button onClick={() => setActiveTab('TRADES')} className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'TRADES' ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-500'}`}>
              <div className="flex items-center gap-2"><Database size={14} /> TRADES</div>
          </button>
          <button onClick={() => setActiveTab('PERF')} className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'PERF' ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-500'}`}>
              <div className="flex items-center gap-2"><BarChart3 size={14} /> PERFORMANCE</div>
          </button>
          <button onClick={() => setActiveTab('FEES')} className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'FEES' ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-500'}`}>
              <div className="flex items-center gap-2"><Settings size={14} /> FEE MODEL</div>
          </button>
          <button onClick={() => setActiveTab('TEST')} className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'TEST' ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-500'}`}>
              <div className="flex items-center gap-2"><FlaskConical size={14} /> TEST SETUP</div>
          </button>
      </div>

      {/* CONTENT AREA */}
      <div className="bg-black border border-zinc-800 rounded-lg min-h-[600px] p-4">
        
        {/* TAB: TRADES */}
        {activeTab === 'TRADES' && (
            <div>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-sm font-bold text-white uppercase flex items-center gap-2">
                        <History size={16} /> Decision Log
                    </h2>
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={useCalibratedConfidence} onChange={e => setUseCalibratedConfidence(e.target.checked)} className="rounded bg-zinc-800 border-zinc-700" />
                            Use Calibrated Confidence
                        </label>
                        <button onClick={fetchTrades} className="text-[10px] bg-zinc-900 border border-zinc-800 px-2 py-1 rounded hover:bg-zinc-800">REFRESH</button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-zinc-900/50 text-[10px] uppercase text-zinc-500 font-mono">
                            <tr>
                                <th className="p-3">Time</th>
                                <th className="p-3">Market</th>
                                <th className="p-3">Side</th>
                                <th className="p-3">Decision</th>
                                <th className="p-3 text-right">Entry Prob</th>
                                <th className="p-3 text-right">Conf</th>
                                <th className="p-3 text-right">Fee %</th>
                                <th className="p-3 text-right text-emerald-500">Edge %</th>
                                <th className="p-3 text-right text-blue-400">EV ($)</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono text-xs">
                            {trades.map(trade => {
                                const conf = useCalibratedConfidence ? getCalibratedConfidence(trade.confidence) : trade.confidence;
                                // If calibrated, recalculate basic Edge proxy for display (simplified)
                                const edgeDisplay = useCalibratedConfidence ? (trade.edge_after_fees_pct * (conf / trade.confidence)) : trade.edge_after_fees_pct;

                                return (
                                <tr key={trade.id} className="border-b border-zinc-900 hover:bg-zinc-900/20">
                                    <td className="p-3 text-zinc-500">{new Date(trade.created_at).toLocaleTimeString()}</td>
                                    <td className="p-3 text-zinc-300">{trade.market_id?.split('-')[0] || 'Unknown'}</td>
                                    <td className={`p-3 font-bold ${trade.side === 'UP' ? 'text-emerald-400' : 'text-red-400'}`}>{trade.side}</td>
                                    <td className="p-3">
                                        <span className={`px-2 py-0.5 rounded text-[10px] ${trade.status === 'EXECUTED' ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-900 text-zinc-500'}`}>
                                            {trade.decision_reason || trade.status}
                                        </span>
                                    </td>
                                    <td className="p-3 text-right">{trade.entry_prob?.toFixed(2)}</td>
                                    <td className="p-3 text-right">{(conf * 100).toFixed(0)}%</td>
                                    <td className="p-3 text-right text-zinc-500">{formatPct(trade.buy_fee_pct)}</td>
                                    <td className={`p-3 text-right font-bold ${edgeDisplay > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {formatPct(edgeDisplay / 100)}
                                    </td>
                                    <td className="p-3 text-right text-blue-400">{formatUsd(trade.ev_after_fees_usd)}</td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* TAB: FEE MODEL */}
        {activeTab === 'FEES' && feeConfig && (
            <div className="grid grid-cols-2 gap-8">
                <div>
                    <h2 className="text-sm font-bold text-white uppercase mb-4 flex items-center gap-2">
                        <Settings size={16} /> Fee Configuration
                    </h2>
                    
                    <div className="space-y-4 bg-zinc-900/50 p-4 rounded border border-zinc-800">
                        {/* BUY FEES */}
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-emerald-500">Buy Fee Peak %</label>
                            <input type="range" min="0" max="0.10" step="0.001" 
                                   value={feeConfig.buy_fee_peak_pct} 
                                   onChange={e => updateFeeConfig('buy_fee_peak_pct', parseFloat(e.target.value))}
                                   className="w-full accent-emerald-500" />
                            <div className="text-right text-xs font-mono">{formatPct(feeConfig.buy_fee_peak_pct)}</div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-emerald-500">Buy Fee Peak Probability</label>
                            <input type="range" min="0" max="1" step="0.05" 
                                   value={feeConfig.buy_fee_peak_at_prob} 
                                   onChange={e => updateFeeConfig('buy_fee_peak_at_prob', parseFloat(e.target.value))}
                                   className="w-full accent-emerald-500" />
                            <div className="text-right text-xs font-mono">{feeConfig.buy_fee_peak_at_prob}</div>
                        </div>

                        <hr className="border-zinc-800" />

                        {/* SELL FEES */}
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-yellow-500">Sell Fee Peak %</label>
                            <input type="range" min="0" max="0.10" step="0.001" 
                                   value={feeConfig.sell_fee_peak_pct} 
                                   onChange={e => updateFeeConfig('sell_fee_peak_pct', parseFloat(e.target.value))}
                                   className="w-full accent-yellow-500" />
                            <div className="text-right text-xs font-mono">{formatPct(feeConfig.sell_fee_peak_pct)}</div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-yellow-500">Sell Fee Peak Probability</label>
                            <input type="range" min="0" max="1" step="0.05" 
                                   value={feeConfig.sell_fee_peak_at_prob} 
                                   onChange={e => updateFeeConfig('sell_fee_peak_at_prob', parseFloat(e.target.value))}
                                   className="w-full accent-yellow-500" />
                            <div className="text-right text-xs font-mono">{feeConfig.sell_fee_peak_at_prob}</div>
                        </div>

                        <hr className="border-zinc-800" />
                        
                         <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-zinc-500">Shape Exponent (Curve Sharpness)</label>
                            <input type="number" step="0.1" 
                                   value={feeConfig.shape_exponent} 
                                   onChange={e => updateFeeConfig('shape_exponent', parseFloat(e.target.value))}
                                   className="w-full bg-black border border-zinc-700 p-1 text-xs text-white" />
                        </div>
                    </div>
                </div>

                <div>
                    <h2 className="text-sm font-bold text-white uppercase mb-4 flex items-center gap-2">
                        <TrendingUp size={16} /> Visualization
                    </h2>
                    {renderFeeCurve()}

                    <div className="bg-blue-900/20 border border-blue-900/50 p-4 rounded mt-4">
                        <h4 className="text-blue-400 font-bold text-xs uppercase mb-2 flex items-center gap-2">
                             <Target size={14} /> EV Logic Explanation
                        </h4>
                        <p className="text-[10px] text-blue-200/70 leading-relaxed">
                            <strong>Edge After Fees</strong> is calculated as:<br/>
                            <code>EV / Cost_Paid</code><br/><br/>
                            Where:<br/>
                            1. <strong>Cost_Paid</strong> = Stake ($)<br/>
                            2. <strong>Stake_Net</strong> = Stake * (1 - Buy_Fee)<br/>
                            3. <strong>Return_Win_Net</strong> = (Stake_Net / Entry_Price) * 1.0 * (1 - Sell_Fee)<br/>
                            4. <strong>EV</strong> = (Confidence * Return_Win_Net) - Cost_Paid
                        </p>
                    </div>
                </div>
            </div>
        )}

        {/* TAB: PERF */}
        {activeTab === 'PERF' && (
             <div className="flex flex-col items-center justify-center h-full text-zinc-500 py-12">
                 <BarChart3 size={48} className="opacity-50 mb-4" />
                 <p>Performance Aggregation requires 24h+ of Trade Data.</p>
                 <p className="text-xs mt-2">Current Trade Count: {trades.length}</p>
             </div>
        )}

        {/* TAB: TEST SETUP */}
        {activeTab === 'TEST' && (
            <div className="max-w-xl mx-auto">
                 <h2 className="text-sm font-bold text-white uppercase mb-4 flex items-center gap-2">
                        <FlaskConical size={16} /> Configure Experiment
                </h2>
                <div className="space-y-4 bg-zinc-900/50 p-6 rounded border border-zinc-800">
                    <div>
                        <label className="text-xs font-bold text-zinc-400 block mb-1">Experiment Name</label>
                        <input value={testRunName} onChange={e => setTestRunName(e.target.value)} className="w-full bg-black border border-zinc-700 p-2 text-sm text-white rounded" />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-zinc-400 block mb-1">Hypothesis</label>
                        <textarea className="w-full bg-black border border-zinc-700 p-2 text-sm text-white rounded h-20" placeholder="e.g. Higher fee approximation will reduce false positives in 60-70% confidence range."></textarea>
                    </div>
                    <button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded">
                        CREATE NEW TEST RUN
                    </button>
                </div>
            </div>
        )}

      </div>
    </div>
  );
};
