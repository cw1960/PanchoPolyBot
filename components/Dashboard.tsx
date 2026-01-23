import React, { useEffect, useMemo, useState } from "react";
import { Shield, CheckCircle, AlertTriangle } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/* =========================
   SUPABASE CLIENT
========================= */
const SUPABASE_URL = "https://bnobbksmuhhnikjprems.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg";

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
  expected_pnl?: number;
  signal_type?: string;
  created_at: string;
}

/* =========================
   DASHBOARD
========================= */
export const Dashboard: React.FC = () => {
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [estimatedReturn, setEstimatedReturn] = useState<number>(0);

  /* ---------- BANKROLL ---------- */
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("bot_bankroll")
        .select("*")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setBankroll(data as any);
    };
    load();
    const i = setInterval(load, 3000);
    return () => clearInterval(i);
  }, []);

  /* ---------- SETTLEMENTS ---------- */
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("bot_settlements")
        .select("*")
        .order("settled_at", { ascending: false })
        .limit(50);
      setSettlements((data || []) as any);
    };
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  /* ---------- TICKS ---------- */
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("bot_ticks")
        .select("slug, expected_pnl, signal_type, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      setTicks((data || []) as any);
    };
    load();
    const i = setInterval(load, 3000);
    return () => clearInterval(i);
  }, []);

  /* ---------- ESTIMATED RETURN ---------- */
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.rpc("sql", {
        query: `
          select coalesce(sum(expected_pnl),0) as v
          from bot_ticks
          where signal_type = 'PAIR_MERGE'
            and expected_pnl is not null
            and slug not in (select slug from bot_settlements)
        `,
      });
      if (data?.[0]?.v != null) setEstimatedReturn(Number(data[0].v));
    };
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  /* ---------- DERIVED ---------- */
  const realizedPnl = useMemo(
    () => settlements.reduce((a, s) => a + Number(s.pnl || 0), 0),
    [settlements]
  );

  const openPositionCost = bankroll?.exposure ?? 0;
  const netEquity = bankroll?.bankroll ?? 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6">
      <h1 className="text-2xl font-mono mb-6 flex items-center gap-2">
        <Shield className="text-emerald-500" />
        BOT TRUTH DASHBOARD
      </h1>

      {/* METRICS */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        <Metric label="Bankroll" value={bankroll?.bankroll.toFixed(2)} />
        <Metric label="Open Position Cost" value={openPositionCost.toFixed(2)} />
        <Metric label="Estimated Return" value={estimatedReturn.toFixed(4)} />
        <Metric label="Realized PnL" value={realizedPnl.toFixed(2)} />
        <Metric label="Net Equity" value={netEquity.toFixed(2)} />
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
    <div className="text-lg font-mono text-white">{value ?? "--"}</div>
  </div>
);
