import React, { useState, useEffect } from 'react';
import { Shield, CheckCircle } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

/* =========================
   SUPABASE CLIENT
========================= */
const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =========================
   TYPES
========================= */
interface BankrollRow {
  bankroll: number;
  cap_per_market: number;
  exposure: number;
  ts: string;
}

interface SettlementRow {
  slug: string;
  final_outcome: string;
  pnl: number;
  settlement_method: string;
  settled_at: string;
}

interface Tick {
  slug: string;
  yes_price: number;
  no_price: number;
  edge_after_fees: number;
  recommended_size: number;
  created_at: string;
}

/* =========================
   DASHBOARD
========================= */
export const Dashboard: React.FC = () => {
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);

  /* ---------- BANKROLL (LIVE SNAPSHOT) ---------- */
  useEffect(() => {
    loadBankroll();
    const i = setInterval(loadBankroll, 3000);
    return () => clearInterval(i);
  }, []);

  async function loadBankroll() {
    const { data } = await supabase
      .from('bot_bankroll')
      .select('*')
      .order('ts', { ascending: false })
      .limit(1)
      .single();

    if (data) setBankroll(data);
  }

  /* ---------- SETTLEMENTS (REALIZED PNL) ---------- */
  useEffect(() => {
    loadSettlements();
    const i = setInterval(loadSettlements, 5000);
    return () => clearInterval(i);
  }, []);

  async function loadSettlements() {
    const { data } = await supabase
      .from('bot_settlements')
      .select('*')
      .order('settled_at', { ascending: false })
      .limit(20);

    if (data) setSettlements(data);
  }

  /* ---------- TICKS (RAW TELEMETRY) ---------- */
  useEffect(() => {
    loadTicks();
    const i = setInterval(loadTicks, 3000);
    return () => clearInterval(i);
  }, []);

  async function loadTicks() {
    const { data } = await supabase
      .from('bot_ticks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (data) setTicks(data);
  }

  /* ---------- DERIVED METRICS ---------- */
  const realizedPnl = settlements.reduce((a, s) => a + s.pnl, 0);
  const exposure = bankroll?.exposure ?? 0;
  const netEquity = (bankroll?.bankroll ?? 0) + exposure;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6">
      <h1 className="text-2xl font-mono flex items-center gap-2 mb-6">
        <Shield className="text-emerald-500" />
        BOT TRUTH DASHBOARD
      </h1>

      {/* ================= METRICS ================= */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Metric label="Bankroll" value={bankroll?.bankroll.toFixed(2)} />
        <Metric label="Exposure (Unrealized)" value={exposure.toFixed(2)} />
        <Metric label="Realized PnL" value={realizedPnl.toFixed(2)} />
        <Metric label="Net Equity" value={netEquity.toFixed(2)} />
      </div>

      {/* ================= SETTLED MARKETS ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4 mb-8">
        <h2 className="text-sm text-zinc-400 mb-2 flex items-center gap-2">
          <CheckCircle className="text-emerald-400" />
          Resolved Markets
        </h2>

        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-zinc-900 sticky top-0">
              <tr>
                <th className="p-2 text-left">Market</th>
                <th className="p-2">Outcome</th>
                <th className="p-2">PnL</th>
                <th className="p-2">Method</th>
                <th className="p-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s, i) => (
                <tr key={i} className="border-t border-zinc-800">
                  <td className="p-2 truncate max-w-[220px]">{s.slug}</td>
                  <td className="p-2 text-center">{s.final_outcome}</td>
                  <td
                    className={`p-2 text-center ${
                      s.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {s.pnl.toFixed(2)}
                  </td>
                  <td className="p-2 text-center">{s.settlement_method}</td>
                  <td className="p-2 text-center">
                    {new Date(s.settled_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
              {settlements.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-zinc-500">
                    No markets settled yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= RAW TICKS ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4">
        <h2 className="text-xs text-zinc-500 mb-2">Raw Tick Telemetry</h2>
        <table className="w-full text-xs font-mono">
          <thead className="bg-zinc-900">
            <tr>
              <th className="p-2 text-left">time</th>
              <th className="p-2 text-left">market</th>
              <th className="p-2">edge</th>
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
                <td className="p-2 text-center">{t.edge_after_fees.toFixed(4)}</td>
                <td className="p-2 text-center">{t.recommended_size.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* =========================
   SMALL COMPONENT
========================= */
const Metric = ({ label, value }: any) => (
  <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
    <div className="text-[10px] uppercase text-zinc-500">{label}</div>
    <div className="text-lg font-mono text-white">{value ?? '--'}</div>
  </div>
);
