import React, { useEffect, useMemo, useState } from "react";
import { Shield, CheckCircle, AlertTriangle } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/* ---------- SUPABASE CLIENT ---------- */
const SUPABASE_URL = "https://bnobbksmuhhnikjprems.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- TYPES ---------- */
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
  created_at: string;
}

export const Dashboard: React.FC = () => {
  const [runId, setRunId] = useState<string | null>(null);
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);

  /* ---------- ACTIVE RUN ---------- */
  useEffect(() => {
    supabase
      .from("bot_runs")
      .select("run_id")
      .eq("status", "RUNNING")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setRunId(data?.run_id ?? null));
  }, []);

  /* ---------- BANKROLL ---------- */
  useEffect(() => {
    if (!runId) return;
    supabase
      .from("bot_bankroll")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setBankroll(data ?? null));
  }, [runId]);

  /* ---------- SETTLEMENTS ---------- */
  useEffect(() => {
    if (!runId) return;
    supabase
      .from("bot_settlements")
      .select("*")
      .eq("run_id", runId)
      .order("settled_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setSettlements((data ?? []) as any));
  }, [runId]);

  /* ---------- TICKS ---------- */
  useEffect(() => {
    if (!runId) return;
    supabase
      .from("bot_ticks")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setTicks((data ?? []) as any));
  }, [runId]);

  const realizedPnl = useMemo(
    () => settlements.reduce((a, s) => a + Number(s.pnl || 0), 0),
    [settlements]
  );

  const estimatedReturn = useMemo(
    () => ticks.reduce((a, t) => a + Number(t.expected_pnl || 0), 0),
    [ticks]
  );

  const openPositionCost = bankroll?.exposure ?? 0;
  const netEquity = bankroll?.bankroll ?? 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6">
      <h1 className="text-2xl font-mono flex items-center gap-2 mb-4">
        <Shield className="text-emerald-500" />
        BOT TRUTH DASHBOARD
      </h1>

      <div className="grid grid-cols-5 gap-4 mb-8">
        <Metric label="Bankroll" value={bankroll?.bankroll.toFixed(2)} />
        <Metric label="Open Position Cost" value={openPositionCost.toFixed(2)} />
        <Metric label="Estimated Return" value={estimatedReturn.toFixed(2)} />
        <Metric label="Realized PnL" value={realizedPnl.toFixed(2)} />
        <Metric label="Net Equity" value={netEquity.toFixed(2)} />
      </div>
    </div>
  );
};

const Metric = ({ label, value }: any) => (
  <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
    <div className="text-[10px] uppercase text-zinc-500">{label}</div>
    <div className="text-lg font-mono text-white">{value ?? "--"}</div>
  </div>
);
