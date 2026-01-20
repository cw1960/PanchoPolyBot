
import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { Search, ChevronRight, Activity, TrendingUp, AlertCircle } from 'lucide-react';

const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface BotMarket {
  slug: string;
  start_time: string;
  end_time: string;
  total_pnl_usd: number;
  trade_count: number;
  avg_edge_captured: number;
  max_drawdown_usd: number;
  regime_tag: string;
}

interface BotTick {
  ts: string;
  yes_price: number;
  model_prob: number;
  signal_tag: string;
  spread: number;
}

export const MarketsView: React.FC = () => {
  const [markets, setMarkets] = useState<BotMarket[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [ticks, setTicks] = useState<BotTick[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchMarkets();
  }, []);

  useEffect(() => {
    if (selectedSlug) {
      fetchTicks(selectedSlug);
    }
  }, [selectedSlug]);

  const fetchMarkets = async () => {
    const { data } = await supabase
      .from('bot_markets')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(50);
    if (data) setMarkets(data);
  };

  const fetchTicks = async (slug: string) => {
    setLoading(true);
    const { data } = await supabase
      .from('bot_ticks')
      .select('ts, yes_price, model_prob, signal_tag, spread')
      .eq('market_slug', slug)
      .order('ts', { ascending: true })
      .limit(2000); // Cap for performance
    
    if (data) {
        // Downsample if needed for chart perf
        setTicks(data);
    }
    setLoading(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-500 h-[calc(100vh-140px)]">
      
      {/* LEFT: Market List */}
      <div className="lg:col-span-1 bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/50">
           <h3 className="text-sm font-bold text-zinc-400 uppercase flex items-center gap-2">
             <Search size={14} /> Market History
           </h3>
        </div>
        
        <div className="overflow-y-auto flex-1 custom-scrollbar">
            {markets.map(m => (
                <div 
                    key={m.slug}
                    onClick={() => setSelectedSlug(m.slug)}
                    className={`p-4 border-b border-zinc-800/50 cursor-pointer transition-colors ${selectedSlug === m.slug ? 'bg-zinc-800 border-l-2 border-l-emerald-500' : 'hover:bg-zinc-800/30'}`}
                >
                    <div className="flex justify-between items-start mb-2">
                        <div className="font-mono text-xs text-zinc-300 font-bold truncate max-w-[180px]" title={m.slug}>
                            {m.slug}
                        </div>
                        <span className={`text-xs font-mono font-bold ${m.total_pnl_usd >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {m.total_pnl_usd > 0 ? '+' : ''}{m.total_pnl_usd.toFixed(2)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-zinc-500">
                         <span>{new Date(m.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                         <span className="flex items-center gap-2">
                            <span className="bg-zinc-800 px-1.5 rounded">{m.trade_count} Trades</span>
                            <ChevronRight size={12} />
                         </span>
                    </div>
                </div>
            ))}
        </div>
      </div>

      {/* RIGHT: Detail View */}
      <div className="lg:col-span-2 flex flex-col gap-6 h-full overflow-y-auto custom-scrollbar">
        {selectedSlug && markets.find(m => m.slug === selectedSlug) ? (
            <>
                {/* Stats Header */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                    {(() => {
                        const m = markets.find(x => x.slug === selectedSlug)!;
                        return (
                            <div className="grid grid-cols-4 gap-4">
                                <div>
                                    <div className="text-[10px] uppercase text-zinc-500 font-bold">Total PnL</div>
                                    <div className={`text-2xl font-mono font-bold ${m.total_pnl_usd >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                        ${m.total_pnl_usd.toFixed(2)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase text-zinc-500 font-bold">Avg Edge</div>
                                    <div className="text-2xl font-mono font-bold text-blue-400">
                                        {(m.avg_edge_captured * 100).toFixed(2)}%
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase text-zinc-500 font-bold">Max Drawdown</div>
                                    <div className="text-2xl font-mono font-bold text-red-400">
                                        -${Math.abs(m.max_drawdown_usd).toFixed(2)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase text-zinc-500 font-bold">Regime</div>
                                    <div className="text-2xl font-mono font-bold text-zinc-300">
                                        {m.regime_tag || 'N/A'}
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </div>

                {/* Tick Chart */}
                <div className="bg-black border border-zinc-800 rounded-xl p-4 flex-1 min-h-[400px]">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2">
                            <Activity size={14} /> Micro-Structure Analysis
                        </h3>
                        {loading && <span className="text-xs text-emerald-500 animate-pulse">Loading Ticks...</span>}
                    </div>
                    
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={ticks}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                            <XAxis 
                                dataKey="ts" 
                                tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], {minute:'2-digit', second:'2-digit'})} 
                                stroke="#52525b" 
                                fontSize={10} 
                                minTickGap={30}
                            />
                            <YAxis domain={[0, 1]} stroke="#52525b" fontSize={10} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a' }}
                                labelFormatter={(label) => new Date(label).toLocaleTimeString()}
                            />
                            <Line 
                                type="stepAfter" 
                                dataKey="yes_price" 
                                stroke="#10b981" 
                                strokeWidth={2} 
                                dot={false} 
                                name="Market Price" 
                            />
                            <Line 
                                type="monotone" 
                                dataKey="model_prob" 
                                stroke="#3b82f6" 
                                strokeWidth={1} 
                                strokeDasharray="5 5" 
                                dot={false} 
                                name="Fair Value" 
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </>
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-zinc-900/30 border border-zinc-800 border-dashed rounded-xl">
                <AlertCircle size={48} className="text-zinc-700 mb-4" />
                <p className="text-zinc-500 font-mono">Select a market to analyze ticks</p>
            </div>
        )}
      </div>

    </div>
  );
};
