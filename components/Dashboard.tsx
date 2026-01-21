import React, { useState, useEffect } from 'react';
import {
  Shield
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';

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
  const [ticksConnected, setTicksConnected] = useState(false);
  const [bankrollConnected, setBankrollConnected] = useState(false);

  /* -------------------- TICKS (POLLING) -------------------- */
  useEffect(() => {
    loadTicks();
    const i = setInterval(loadTicks, 2000);
    return () => clearInterval(i);
  }, []);

  async function loadTicks() {
    try {
      const { data, error } = await supabase
        .from('bot_ticks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('ticks error', error);
        setTicksConnected(false);
        return;
      }

      setTicks(data || []);
      setTicksConnected(true);
    } catch (err) {
      console.error('ticks load failed', err);
      setTicksConnected(false);
    }
  }

  /* -------------------- BANKROLL (REALTIME) -------------------- */
  useEffect(() => {
    let channel: any;

    async function initBankroll() {
      const { data, error } = await supabase
        .from('bot_bankroll_current')
        .select('*')
        .single();

      if (!error && data) {
        setBankroll(data);
        setBankrollConnected(true);
      } else {
        console.error('bankroll load error', error);
        setBankrollConnected(false);
      }

      channel = supabase
        .channel('bankroll-current')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'bot_bankroll_current'
          },
          (payload) => {
            if (payload.new) {
              setBankroll(payload.new as BankrollRow);
              setBankrollConnected(true);
            }
          }
        )
        .subscribe();
    }

    initBankroll();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const connected = ticksConnected && bankrollConnected;
  const latest = ticks.length > 0 ? ticks[0] : null;

  /* ---- ESTIMATED PAPER PNL (DISPLAY ONLY) ---- */
  const runningPnl = ticks.reduce((acc, t) => {
    return acc + (1 - t.pair_cost) * t.recommended_size;
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
        <span
          className={`ml-4 text-xs px-2 py-1 rounded ${
            connected
              ? 'bg-emerald-900 text-emerald-200'
              : 'bg-red-900 text-red-200'
          }`}
        >
          {connected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
      </h1>

      {/* BANKROLL */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card
          label="Bankroll"
          value={bankroll ? bankroll.bankroll.toFixed(2) : '--'}
        />
        <Card
          label="Cap / Market"
          value={bankroll ? bankroll.cap_per_market.toFixed(2) : '--'}
        />
        <Card
          label="Exposure"
          value={bankroll ? bankroll.exposure.toFixed(2) : '--'}
        />
      </div>

      {/* ESTIMATED PNL */}
      {latest && (
        <div className="bg-black border border-zinc-800 p-4 rounded mb-6">
          <h2 className="text-xs text-zinc-500 mb-2">
            ESTIMATED PAPER PNL
          </h2>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <Card label="Last Trade PnL $" value={lastPnl.toFixed(2)} />
            <Card label="Edge %" value={lastEdgePct.toFixed(3) + '%'} />
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
                  <td className="p-2 truncate max-w-[220px]">{t.slug}</td>
                  <td className="p-2 text-center">{t.yes_price}</td>
                  <td className="p-2 text-center">{t.no_price}</td>
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
