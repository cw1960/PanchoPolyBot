
import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { Wallet, ShieldAlert, TrendingUp } from 'lucide-react';

const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface BankrollPoint {
  ts: string;
  total_bankroll_usd: number;
  total_exposure_usd: number;
  cap_per_market_usd: number;
  active_markets_count: number;
}

export const BankrollView: React.FC = () => {
  const [data, setData] = useState<BankrollPoint[]>([]);

  useEffect(() => {
    fetchBankroll();
  }, []);

  const fetchBankroll = async () => {
    const { data } = await supabase
      .from('bot_bankroll')
      .select('*')
      .order('ts', { ascending: true })
      .limit(500); // Reasonable history
    if (data) setData(data);
  };

  if (data.length === 0) return <div className="p-12 text-center text-zinc-500">No bankroll data recorded yet.</div>;

  const current = data[data.length - 1];
  const start = data[0];
  const totalReturn = ((current.total_bankroll_usd - start.total_bankroll_usd) / start.total_bankroll_usd) * 100;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* KPI CARDS */}
      <div className="grid grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-xl">
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                <Wallet size={14} /> Total Equity
            </div>
            <div className="text-4xl font-mono font-bold text-white">
                ${current.total_bankroll_usd.toFixed(2)}
            </div>
        </div>
        
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-xl">
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                <TrendingUp size={14} /> Total Return
            </div>
            <div className={`text-4xl font-mono font-bold ${totalReturn >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {totalReturn > 0 ? '+' : ''}{totalReturn.toFixed(2)}%
            </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-xl">
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                <ShieldAlert size={14} /> Current Exposure
            </div>
            <div className="text-4xl font-mono font-bold text-yellow-500">
                ${current.total_exposure_usd.toFixed(2)}
            </div>
            <div className="text-xs text-zinc-500 mt-2">
                Across {current.active_markets_count} Active Markets
            </div>
        </div>
      </div>

      {/* EQUITY CURVE */}
      <div className="bg-black border border-zinc-800 rounded-xl p-6 h-[400px]">
         <h3 className="text-xs font-bold text-zinc-500 uppercase mb-6">Equity Growth Curve</h3>
         <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
                <defs>
                    <linearGradient id="colorBankroll" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis 
                    dataKey="ts" 
                    tickFormatter={(ts) => new Date(ts).toLocaleDateString()} 
                    stroke="#52525b" 
                    fontSize={10} 
                    minTickGap={50}
                />
                <YAxis domain={['auto', 'auto']} stroke="#52525b" fontSize={10} tickFormatter={(v) => `$${v}`} />
                <Tooltip 
                    contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a' }}
                    labelFormatter={(label) => new Date(label).toLocaleString()}
                />
                <Area 
                    type="monotone" 
                    dataKey="total_bankroll_usd" 
                    stroke="#10b981" 
                    fillOpacity={1} 
                    fill="url(#colorBankroll)" 
                    name="Bankroll"
                />
            </AreaChart>
         </ResponsiveContainer>
      </div>

      {/* EXPOSURE vs CAP */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 h-[300px]">
         <h3 className="text-xs font-bold text-zinc-500 uppercase mb-6">Risk Utilization (Exposure vs Cap)</h3>
         <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="ts" hide />
                <YAxis stroke="#52525b" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a' }} />
                <Line 
                    type="stepAfter" 
                    dataKey="total_exposure_usd" 
                    stroke="#eab308" 
                    strokeWidth={2} 
                    dot={false} 
                    name="Exposure"
                />
                {/* Visualizing Cap roughly if tracked, otherwise static */}
            </LineChart>
         </ResponsiveContainer>
      </div>

    </div>
  );
};
