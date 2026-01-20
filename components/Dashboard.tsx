import React, { useState, useEffect } from 'react';
import {
  Play, Square, Shield, LayoutDashboard, LineChart,
  BarChart2, Wallet, Microscope, Settings, Save, RotateCcw
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';
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
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    loadData();
    const i = setInterval(loadData, 2000);
    return () => clearInterval(i);
  }, []);

  async function loadData() {
    try {
      // --- LOAD TICKS ---
      const { data: t, error: e1 } = await supabase
        .from('bot_ticks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (e1) {
        console.error("ticks error", e1);
        setConnected(false);
        return;
      }

      setTicks(t || []);
      setConnected(true);

      // --- LOAD BANKROLL ---
      const { data: b, error: e2 } = await supabase
        .from('bot_bankroll')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!e2 && b) {
        setBankroll(b);
      }

    } catch (err) {
      console.error("dashboard load failed", err);
      setConnected(false);
    }
  }

  const latest = ticks.length > 0 ? ticks[0] : null;

  // ---- PNL CALCULATIONS ----
  const runningPnl = ticks.reduce((acc, t) => {
    const pnl = (1 - t.pair_cost) * t.recommended_size;
    return acc + pnl;
  }, 0);

  const lastPnl = latest
    ? (1 - latest.pair_cost) * latest.recommended_size
    : 0;

  const lastEdgePct = latest
    ? (1 - latest.pair_cost) * 100
    : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 p-6">

      <h1 className="text-2xl font-mono text-white flex items-center gap-2 mb-6">
        <Shield className="text-emerald-500" />
        LIVE BOT TELEMETRY
        <span className={`ml-4 text-xs px-2 py-1 rounded ${
          connected ? 'bg-emerald-900 text-emerald-200' : 'bg-red-900 text-red-200'
        }`}>
          {connected ? "CONNECTED" : "DISCONNECTED"}
        </span>
      </h1>

      {/* BANKROLL */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card label="Bankroll" value={bankroll?.bankroll?.toFixed(2) ?? "--"} />
        <Card label="Cap / Market" value={bankroll?.cap_per_market?.toFixed(2) ?? "--"} />
        <Card label="Exposure" value={bankroll?.exposure?.toFixed(2) ?? "--"} />
      </div>

      {/* ===== NEW PNL SECTION ===== */}
      {latest && (
        <div className="bg-black border border-zinc-800 p-4 rounded mb-6">

          <h2 className="text-xs text-zinc-500 mb-2">
            ESTIMATED PAPER PNL
          </h2>

          <div className="grid grid-cols-3 gap-4 mb-4">

            <Card
              label="Last Trade PnL $"
              value={lastPnl.toFixed(2)}
            />

            <Card
              label="Edge %"
              value={lastEdgePct.toFixed(3) + "%"}
            />

            <Card
              label="Kelly Size $"
              value={latest.recommended_size.toFixed(2)}
            />

          </div>

          <div className="font-mono text-sm text-emerald-400">
            Running estimate: {runningPnl.toFixed(2)}
          </div>

        </div>
      )}
      {/* ===== END NEW SECTION ===== */}

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

      {/* EMPTY STATE */}
      {ticks.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded p-6 text-center text-zinc-500">
          Waiting for telemetry from bot_ticks...
        </div>
      )}

      {/* RAW TICKS */}
      {ticks.length > 0 && (
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
                  <td className="p-2">
                    {new Date(t.created_at).toLocaleTimeString()}
                  </td>

                  <td className="p-2 truncate max-w-[220px]">
                    {t.slug}
                  </td>

                  <td className="p-2 text-center">
                    {t.yes_price}
                  </td>

                  <td className="p-2 text-center">
                    {t.no_price}
                  </td>

                  <td className="p-2 text-center">
                    {t.edge_after_fees.toFixed(4)}
                  </td>

                  <td className="p-2 text-center">
                    {t.kelly_fraction.toFixed(4)}
                  </td>

                  <td className="p-2 text-center">
                    {t.recommended_size.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
};

const Card = ({ label, value }: any) => (
  <div className="bg-zinc-900 p-3 rounded border border-zinc-800">
    <div className="text-[10px] text-zinc-500 uppercase">{label}</div>
    <div className="text-lg font-mono text-white truncate">{value}</div>
  </div>
);
