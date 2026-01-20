
import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, ZAxis
} from 'recharts';
import { Microscope, Percent } from 'lucide-react';

const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const ResearchView: React.FC = () => {
  const [ticks, setTicks] = useState<any[]>([]);
  const [pairCostData, setPairCostData] = useState<any[]>([]);
  const [sizingData, setSizingData] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data } = await supabase
      .from('bot_ticks')
      .select('*')
      .order('ts', { ascending: false })
      .limit(1000);

    if (data) {
        setTicks(data);
        processPairCost(data);
        processSizing(data);
    }
  };

  const processPairCost = (raw: any[]) => {
      // Create buckets for pair cost (0.98, 0.99, 1.00, 1.01, etc)
      const buckets: Record<string, number> = {};
      raw.forEach(t => {
          const cost = parseFloat(t.pair_cost);
          const bucket = cost.toFixed(2);
          buckets[bucket] = (buckets[bucket] || 0) + 1;
      });
      
      const chartData = Object.keys(buckets).sort().map(k => ({
          cost: k,
          count: buckets[k]
      }));
      setPairCostData(chartData);
  };

  const processSizing = (raw: any[]) => {
      // Filter for ticks where Kelly recommended something
      setSizingData(raw.filter(t => t.kelly_fraction > 0).map(t => ({
          kelly: t.kelly_fraction,
          size: t.recommended_size_usd
      })));
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Pair Cost Distribution */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 h-[400px]">
             <h3 className="text-xs font-bold text-zinc-500 uppercase mb-6 flex items-center gap-2">
                 <Microscope size={14} /> Market Efficiency (Pair Cost)
             </h3>
             <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pairCostData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="cost" stroke="#52525b" fontSize={10} />
                    <YAxis stroke="#52525b" fontSize={10} />
                    <Tooltip 
                        contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a' }}
                        cursor={{fill: '#27272a'}}
                    />
                    <Bar dataKey="count" fill="#3b82f6" name="Ticks" radius={[4, 4, 0, 0]} />
                </BarChart>
             </ResponsiveContainer>
             <p className="text-[10px] text-zinc-500 mt-2 text-center">
                 Distribution of (Yes + No) prices. Values {'>'} 1.00 indicate negative vigorish/arb opportunities.
             </p>
          </div>

          {/* Kelly vs Actual Size */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 h-[400px]">
             <h3 className="text-xs font-bold text-zinc-500 uppercase mb-6 flex items-center gap-2">
                 <Percent size={14} /> Kelly Fraction vs. Sizing
             </h3>
             <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis type="number" dataKey="kelly" name="Kelly Fraction" stroke="#52525b" fontSize={10} domain={[0, 'auto']} />
                    <YAxis type="number" dataKey="size" name="Rec Size (USD)" stroke="#52525b" fontSize={10} />
                    <ZAxis type="number" range={[50, 50]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a' }} />
                    <Scatter name="Sizing" data={sizingData} fill="#10b981" shape="circle" />
                </ScatterChart>
             </ResponsiveContainer>
             <p className="text-[10px] text-zinc-500 mt-2 text-center">
                 Correlation between Model Confidence (Kelly) and Recommended Position Size USD.
             </p>
          </div>

      </div>

    </div>
  );
};
