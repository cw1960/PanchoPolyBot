import React, { useEffect, useMemo, useState } from "react";
import { Shield, CheckCircle, AlertTriangle } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/* =========================
  SUPABASE CLIENT
========================= */
const SUPABASE_URL = "https://bnobbksmuhhnikjprems.supabase.co";

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3Ntd" +
  "WhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4OD" +
  "M2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg";

const resolvedUrl =
  (globalThis as any)?.SUPABASE_URL ||
  (globalThis as any)?.window?.SUPABASE_URL ||
  SUPABASE_URL;

const resolvedKey =
  (globalThis as any)?.SUPABASE_ANON_KEY ||
  (globalThis as any)?.window?.SUPABASE_ANON_KEY ||
  SUPABASE_ANON_KEY;

const supabase = createClient(resolvedUrl, resolvedKey);

/* =========================
  TYPES
========================= */
interface BankrollRow {
  bankroll: number;
  cap_per_market: number;
  exposure: number;
  ts: string;
  run_id?: string;
}

interface SettlementRow {
  slug: string;
  final_outcome: string;
  pnl: number;
  settlement_method: string;
  settled_at: string;
  run_id?: string;
}

interface Tick {
  slug: string;
  edge_after_fees: number;
  recommended_size: number;
  expected_pnl?: number;
  created_at: string;
  run_id?: string;
}

interface ValuationRow {
  slug: string;
  ts: string;
  unrealized_pnl: number;
  pricing_quality: string;
  run_id?: string;
}

/* =========================
  DASHBOARD
========================= */
export const Dashboard: React.FC = () => {
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [valuations, setValuations] = useState<ValuationRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<string | null>(null);

  const [errRun, setErrRun] = useState<string | null>(null);
  const [errBankroll, setErrBankroll] = useState<string | null>(null);
  const [errSettlements, setErrSettlements] = useState<string | null>(null);
  const [errTicks, setErrTicks] = useState<string | null>(null);
  const [errValuations, setErrValuations] = useState<string | null>(null);

  /* =========================
    LOAD ACTIVE RUN
  ========================= */
  useEffect(() => {
    let stop = false;

    async function loadRun() {
      const { data, error } = await supabase
        .from("bot_runs")
        .select("run_id,created_at")
        .eq("status", "RUNNING")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (stop) return;

      if (error) {
        setErrRun(error.message);
        setRunId(null);
        return;
      }

      setErrRun(null);
      setRunId(data?.run_id ?? null);
      setRunStartedAt(data?.created_at ?? null);
    }

    loadRun();
    const i = setInterval(loadRun, 5000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, []);

  /* =========================
    BANKROLL
  ========================= */
  useEffect(() => {
    if (!runId) return;

    supabase
      .from("bot_bankroll")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setErrBankroll(error.message);
        else setBankroll(data);
      });
  }, [runId]);

  /* =========================
    SETTLEMENTS
  ========================= */
  useEffect(() => {
    if (!runId) return;

    supabase
      .from("bot_settlements")
      .select("*")
      .eq("run_id", runId)
      .order("settled_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setErrSettlements(error.message);
        else setSettlements(data ?? []);
      });
  }, [runId]);

  /* =========================
    TICKS
  ========================= */
  useEffect(() => {
    if (!runId) return;

    supabase
      .from("bot_ticks")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) setErrTicks(error.message);
        else setTicks(data ?? []);
      });
  }, [runId]);

  /* =========================
    VALUATIONS
  ========================= */
  useEffect(() => {
    if (!runId) return;

    supabase
      .from("bot_unrealized_valuations")
      .select("*")
      .eq("run_id", runId)
      .order("ts", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) setErrValuations(error.message);
        else setValuations(data ?? []);
      });
  }, [runId]);

  /* =========================
    DERIVED METRICS
  ========================= */
  const openPositionCost = bankroll?.exposure ?? 0;

  const estimatedReturn = useMemo(() => {
    if (openPositionCost === 0) return 0;
    return ticks.reduce((a, t) => a + Number(t.expected_pnl || 0), 0);
  }, [ticks, openPositionCost]);

  const realizedPnl = useMemo(() => {
    if (!runStartedAt) return 0;
    return settlements
      .filter(s => s.settled_at >= runStartedAt)
      .reduce((a, s) => a + Number(s.pnl || 0), 0);
  }, [settlements, runStartedAt]);

  /* =========================
    RENDER
  ========================= */
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6">
      <h1 className="text-2xl font-mono mb-6 flex items-center gap-2">
        <Shield className="text-emerald-500" />
        BOT TRUTH DASHBOARD
      </h1>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <Metric label="Strategy Equity" value={bankroll?.bankroll.toFixed(2)} />
        <Metric label="Open Position Cost" value={openPositionCost.toFixed(2)} />
        <Metric label="Estimated Return" value={estimatedReturn.toFixed(2)} />
        <Metric label="Realized PnL" value={realizedPnl.toFixed(2)} />
      </div>

      {/* EVERYTHING ELSE BELOW IS UNCHANGED */}
    </div>
  );
};

/* =========================
  SMALL COMPONENTS
========================= */
const Metric = ({ label, value }: any) => (
  <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
    <div className="text-[10px] uppercase text-zinc-500">{label}</div>
    <div className="text-lg font-mono text-white">{value ?? "--"}</div>
  </div>
);
