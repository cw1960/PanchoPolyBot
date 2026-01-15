
import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  TrendingUp, TrendingDown, Clock, 
  CheckCircle, XCircle, AlertOctagon,
  Calendar, DollarSign
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';

// Reuse existing supabase client config
const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface MarketResult {
  id: string;
  polymarket_market_id: string;
  asset: string;
  market_end_time: string;
  total_trades: number;
  total_volume_usd: number;
  net_pnl: number;
  roi_pct: number;
  resolution_source: string;
  winning_outcome: string | null;
}

export const ResultsView: React.FC = () => {
  const [results, setResults] = useState<MarketResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    fetchResults();
  }, []);

  const fetchResults = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('market_results')
      .select('*')
      .order('market_end_time', { ascending: false })
      .limit(50); // Last 50 markets

    if (data) {
      setResults(data);
      prepareChartData(data);
    }
    setLoading(false);
  };

  const prepareChartData = (raw: MarketResult[]) => {
    // Sort chronological for chart
    const sorted = [...raw].sort((a, b) => 
      new Date(a.market_end_time).getTime() - new Date(b.market_end_time).getTime()
    );
    
    let runningTotal = 0;
    const curve = sorted.map(r => {
      runningTotal += r.net_pnl;
      return {
        date: new Date(r.market_end_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        pnl: runningTotal,
        rawPnl: r.net_pnl
      };
    });
    setChartData(curve);
  };

  // Metrics
  const totalPnL = results.reduce((acc, r) => acc + r.net_pnl, 0);
  const totalVolume = results.reduce((acc, r) => acc + r.total_volume_usd, 0);
  const winCount = results.filter(r => r.net_pnl > 0).length;
  const winRate = results.length > 0 ? (winCount / results.length) * 100 : 0;
  const avgPnL = results.length > 0 ? totalPnL / results.length : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* SECTION A: SUMMARY METRICS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
          <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
            <DollarSign size={14} /> Net P&L
          </div>
          <div className={`text-3xl font-mono font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
            {totalPnL > 0 ? '+' : ''}{totalPnL.toFixed(2)} <span className="text-sm text-zinc-500">USDC</span>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
          <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
            <CheckCircle size={14} /> Win Rate
          </div>
          <div className="text-3xl font-mono font-bold text-white">
            {winRate.toFixed(0)}%
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {winCount} / {results.length} Markets
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
          <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
            <ActivityIcon size={14} /> Expectancy
          </div>
          <div className={`text-3xl font-mono font-bold ${avgPnL >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
            ${avgPnL.toFixed(2)}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            Avg PnL per Market
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
          <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
            <RefreshIcon size={14} /> Volume
          </div>
          <div className="text-3xl font-mono font-bold text-zinc-300">
            ${totalVolume.toFixed(0)}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            Capital Cycled
          </div>
        </div>
      </div>

      {/* SECTION B: EQUITY CURVE */}
      {chartData.length > 1 && (
        <div className="bg-black border border-zinc-800 rounded-xl p-6 h-[300px]">
          <h3 className="text-xs font-bold text-zinc-500 uppercase mb-4">Cumulative Performance</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis stroke="#52525b" fontSize={10} tickFormatter={(val) => `$${val}`} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a' }}
                itemStyle={{ color: '#fff' }}
              />
              <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="3 3" />
              <Line 
                type="stepAfter" 
                dataKey="pnl" 
                stroke={totalPnL >= 0 ? "#10b981" : "#ef4444"} 
                strokeWidth={2} 
                dot={false} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* SECTION C: MARKET LOG */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex justify-between items-center">
            <h3 className="text-sm font-bold text-white uppercase flex items-center gap-2">
                <Clock size={16} className="text-zinc-500" /> Completed Markets Log
            </h3>
            <span className="text-xs text-zinc-500">Last 50 Entries</span>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-black text-zinc-500 uppercase font-bold">
              <tr>
                <th className="px-6 py-3">Time</th>
                <th className="px-6 py-3">Market</th>
                <th className="px-6 py-3">Resolution</th>
                <th className="px-6 py-3 text-right">Vol</th>
                <th className="px-6 py-3 text-right">Net P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">
              {results.length === 0 ? (
                 <tr>
                     <td colSpan={5} className="px-6 py-8 text-center text-zinc-600 italic">
                         No completed markets recorded yet.
                     </td>
                 </tr>
              ) : (
                  results.map((r) => (
                    <tr key={r.id} className="hover:bg-zinc-800/50 transition-colors">
                      <td className="px-6 py-3 text-zinc-500">
                        {new Date(r.market_end_time).toLocaleTimeString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute:'2-digit' })}
                      </td>
                      <td className="px-6 py-3 max-w-[200px] truncate" title={r.polymarket_market_id}>
                        {r.asset} 15m
                        <span className="block text-[10px] text-zinc-600 truncate">{r.polymarket_market_id}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border ${
                            r.resolution_source === 'EXPIRY' 
                            ? 'bg-zinc-800 border-zinc-700 text-zinc-400' 
                            : 'bg-orange-900/20 border-orange-900/50 text-orange-500'
                        }`}>
                            {r.resolution_source === 'EXPIRY' ? <Clock size={10} /> : <AlertOctagon size={10} />}
                            {r.resolution_source}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right text-zinc-500">
                        ${r.total_volume_usd.toFixed(0)}
                      </td>
                      <td className={`px-6 py-3 text-right font-bold ${r.net_pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {r.net_pnl > 0 ? '+' : ''}{r.net_pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

// Simple Icon Wrappers to avoid import errors if Lucide versions mismatch
const ActivityIcon = (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
const RefreshIcon = (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>;
