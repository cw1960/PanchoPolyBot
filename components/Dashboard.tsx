import React, { useState, useEffect } from 'react';
import {
  Play, Square, Shield, LayoutDashboard, LineChart,
  BarChart2, Wallet, Microscope, Settings, Save, RotateCcw
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface Tick {
  slug: string;
  yes_price: number;
  no_price: number;
  pair_cost: number;
  edge_after_fees: number;
  kelly_fraction: number;
  recommended_size: number;
  signal: string;
  created_at: string;
}

interface BankrollRow {
  bankroll: number;
  cap_per_market: number;
  exposure: number;
  created_at: string;
}

export const Dashboard: React.FC = () => {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);

  useEffect(() => {
    loadData();
    const i = setInterval(loadData, 2000);
    return () => clearInterval(i);
  }, []);

  async function loadData() {
    const { data: t } = await supabase
      .from('bot_ticks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (t) setTicks(t);

    const { data: b } = await supabase
      .from('bot_bankroll')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (b) setBankroll(b);
  }

  const latest = ticks[0];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 p-6">

      <h1 className="text-2xl font-mono text-white flex items-center gap-2 mb-6">
        <Shield className="text-emerald-500" />
        LIVE BOT TELEMETRY
      </h1>

      {/* BANKROLL */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card label="Bankroll" value={bankroll?.bankroll.toFixed(2) ?? "--"} />
        <Card label="Cap / Market" value={bankroll?.cap_per_market.toFixed(2) ?? "--"} />
        <Card label="Exposure" value={bankroll?.exposure.toFixed(2) ?? "--"} />
      </div>

      {/* LATEST SIGNAL */}
      {latest && (
        <div className="bg-black border border-zinc-800 p-4 rounded mb-6">
          <h2 className="text-xs text-zinc-500 mb-2">LATEST SIGNAL</h2>

          <div className="grid grid-cols-4 gap-4">
            <Card label="Market" value={latest.slug} />
            <Card label="Edge" value={latest.edge_after_fees.toFixed(4)} />
            <Card label="Kelly" value={latest.kelly_fraction.toFixed(4)} />
            <Card label="Size" value={latest.recommended_size.toFixed(2)} />
          </div>
        </div>
      )}

      {/* RAW TICKS */}
      <div className="bg-black border border-zinc-800 rounded">
        <table className="w-full text-xs font-mono">
          <thead className="bg-zinc-900">
            <tr>
              <th className="p-2 text-left">time</th>
              <th className="p-2 text-left">market</th>
              <th className="p-2">yes</th>
              <th className="p-2">no</th>
              <th className="p-2">edge</th>
              <th className="p-2">kelly</th>
              <th className="p-2">size</th>
            </tr>
          </thead>

          <tbody>
            {ticks.map((t, i) => (
              <tr key={i} className="border-t border-zinc-800">
                <td className="p-2">{new Date(t.created_at).toLocaleTimeString()}</td>
                <td className="p-2">{t.slug}</td>
                <td className="p-2 text-center">{t.yes_price}</td>
                <td className="p-2 text-center">{t.no_price}</td>
                <td className="p-2 text-center">{t.edge_after_fees.toFixed(4)}</td>
                <td className="p-2 text-center">{t.kelly_fraction.toFixed(4)}</td>
                <td className="p-2 text-center">{t.recommended_size.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
};

const Card = ({ label, value }: any) => (
  <div className="bg-zinc-900 p-3 rounded border border-zinc-800">
    <div className="text-[10px] text-zinc-500 uppercase">{label}</div>
    <div className="text-lg font-mono text-white truncate">{value}</div>
  </div>
);
