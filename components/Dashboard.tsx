import React, { useEffect, useMemo, useState } from "react";
import { Shield, CheckCircle, AlertTriangle } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/* =========================
  SUPABASE CLIENT
  IMPORTANT:
  - 401 means missing/invalid key.
  - 403 means RLS/policy denies read.
========================= */
const SUPABASE_URL = "https://bnobbksmuhhnikjprems.supabase.co";

// ✅ PUT YOUR REAL ANON KEY HERE (the long JWT string from Supabase settings)
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3Ntd" +
  "WhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4O" +
  "DM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg";

// Allow optional overrides if you *later* decide to set them on window.
// (Safe even if undefined.)
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
  evidence?: any;
  run_id?: string;
}
interface Tick {
  slug: string;
  yes_price: number;
  no_price: number;
  edge_after_fees: number;
  recommended_size: number;
  expected_pnl?: number; // NEW
  created_at: string;
  run_id?: string;
}
interface ValuationRow {
  slug: string;
  ts: string;
  ts_bucket: number;
  unrealized_pnl: number;
  liquidation_value_net: number;
  pricing_quality: string;
  yes_bid_missing: boolean;
  no_bid_missing: boolean;
  run_id?: string;
}

interface RunEquityRow {
  run_id: string;
  bankroll: number;
  exposure: number;
  unrealized_total: number;
  net_equity: number;
  bankroll_ts: string;
}

/* =========================
  DASHBOARD
========================= */
export const Dashboard: React.FC = () => {
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [valuations, setValuations] = useState<ValuationRow[]>([]);

  // NEW: active run_id
  const [runId, setRunId] = useState<string | null>(null);

  const [runEquity, setRunEquity] = useState<RunEquityRow | null>(null);
  const [errEquity, setErrEquity] = useState<string | null>(null);

  // Connection / debugging truth (so you’re not guessing)
  const [errRun, setErrRun] = useState<string | null>(null);
  const [errBankroll, setErrBankroll] = useState<string | null>(null);
  const [errSettlements, setErrSettlements] = useState<string | null>(null);
  const [errTicks, setErrTicks] = useState<string | null>(null);
  const [errValuations, setErrValuations] = useState<string | null>(null);

  const connected = useMemo(() => {
    const keyLooksReal =
      typeof resolvedKey === "string" &&
      resolvedKey.length > 50 &&
      !resolvedKey.includes("PASTE_YOUR_REAL_ANON_KEY_HERE") &&
      !resolvedKey.includes("YOUR_ANON_KEY_HERE");

    const any401 =
      (errRun || "").includes("401") ||
      (errTicks || "").includes("401") ||
      (errBankroll || "").includes("401") ||
      (errSettlements || "").includes("401") ||
      (errValuations || "").includes("401") ||
      (errEquity || "").includes("401");

    return keyLooksReal && !any401;
  }, [errRun, errBankroll, errSettlements, errTicks, errValuations, errEquity]);

  /* … all logic unchanged … */

  const openPositionCost = bankroll?.exposure ?? 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6">
      {/* … header + banner unchanged … */}

      {/* ================= METRICS ================= */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Metric
          label="Strategy Equity"
          value={bankroll ? bankroll.bankroll.toFixed(2) : "--"}
        />
        <Metric label="Open Position Cost" value={openPositionCost.toFixed(2)} />
        <Metric label="Estimated Return" value={estimatedReturn.toFixed(2)} />
        <Metric label="Realized PnL" value={realizedPnl.toFixed(2)} />
      </div>

      {/* … rest of file unchanged … */}
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

const ErrorBox = ({ title, text }: { title: string; text: string }) => (
  <div className="mb-3 rounded border border-red-900 bg-red-950/30 p-3 text-red-200">
    <div className="text-xs font-mono mb-1">{title}</div>
    <div className="text-xs font-mono opacity-90 whitespace-pre-wrap">{text}</div>
  </div>
);

function formatSbError(table: string, error: any): string {
  const msg = error?.message ? String(error.message) : String(error);
  const code = error?.code ? String(error.code) : "";
  const status = error?.status ? String(error.status) : "";
  return `${table}: ${msg}${code ? ` | code=${code}` : ""}${
    status ? ` | status=${status}` : ""
  }`;
}
