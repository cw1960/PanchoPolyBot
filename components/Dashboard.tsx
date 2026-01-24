import React, { useEffect, useMemo, useState } from "react";
import { Shield, CheckCircle, AlertTriangle } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/* =========================
  SUPABASE CLIENT
========================= */
const SUPABASE_URL = "https://bnobbksmuhhnikjprems.supabase.co";

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3Ntd" +
  "WhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4O" +
  "DM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg";

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
  expected_pnl?: number;
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

interface RunEquityRow {                 // CHANGED
  run_id: string;                        // CHANGED
  bankroll: number;                     // CHANGED
  exposure: number;                     // CHANGED
  unrealized_total: number;             // CHANGED
  net_equity: number;                   // CHANGED
  bankroll_ts: string;                  // CHANGED
}                                       // CHANGED

/* =========================
  DASHBOARD
========================= */
export const Dashboard: React.FC = () => {
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [valuations, setValuations] = useState<ValuationRow[]>([]);

  const [runId, setRunId] = useState<string | null>(null);

  const [runEquity, setRunEquity] = useState<RunEquityRow | null>(null); // CHANGED
  const [errEquity, setErrEquity] = useState<string | null>(null);       // CHANGED

  const [errRun, setErrRun] = useState<string | null>(null);
  const [errBankroll, setErrBankroll] = useState<string | null>(null);
  const [errSettlements, setErrSettlements] = useState<string | null>(null);
  const [errTicks, setErrTicks] = useState<string | null>(null);
  const [errValuations, setErrValuations] = useState<string | null>(null);

  const connected = useMemo(() => {
    const keyLooksReal =
      typeof resolvedKey === "string" &&
      resolvedKey.length > 50 &&
      !resolvedKey.includes("PASTE_YOUR_REAL_ANON_KEY_HERE");

    const any401 =
      (errRun || "").includes("401") ||
      (errTicks || "").includes("401") ||
      (errBankroll || "").includes("401") ||
      (errSettlements || "").includes("401") ||
      (errValuations || "").includes("401") ||
      (errEquity || "").includes("401"); // CHANGED

    return keyLooksReal && !any401;
  }, [errRun, errBankroll, errSettlements, errTicks, errValuations, errEquity]); // CHANGED

  /* ================= RUN ID ================= */
  useEffect(() => {
    let stop = false;
    async function loadRun() {
      try {
        const { data, error } = await supabase
          .from("bot_runs")
          .select("run_id,status,created_at")
          .eq("status", "RUNNING")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (stop) return;
        if (error) {
          setErrRun(formatSbError("bot_runs", error));
          setRunId(null);
          return;
        }
        setErrRun(null);
        setRunId((data as any)?.run_id ?? null);
      } catch (e: any) {
        if (stop) return;
        setErrRun(`bot_runs unexpected: ${String(e?.message ?? e)}`);
        setRunId(null);
      }
    }
    loadRun();
    const i = setInterval(loadRun, 5000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, []);

  /* ================= BANKROLL ================= */
  useEffect(() => {
    let stop = false;
    async function loadBankroll() {
      try {
        if (!runId) {
          setBankroll(null);
          return;
        }
        const { data, error } = await supabase
          .from("bot_bankroll")
          .select("*")
          .eq("run_id", runId)
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (stop) return;
        if (error) {
          setErrBankroll(formatSbError("bot_bankroll", error));
          return;
        }
        setErrBankroll(null);
        if (data) setBankroll(data as any);
      } catch (e: any) {
        if (stop) return;
        setErrBankroll(`bot_bankroll unexpected: ${String(e?.message ?? e)}`);
      }
    }
    loadBankroll();
    const i = setInterval(loadBankroll, 3000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [runId]);

  /* ================= RUN EQUITY (GATE-4) ================= */
  useEffect(() => {
    let stop = false;
    async function loadEquity() {
      try {
        if (!runId) {
          setRunEquity(null);
          return;
        }
        const { data, error } = await supabase
          .from("bot_run_equity_current")
          .select("*")
          .eq("run_id", runId)
          .maybeSingle();

        if (stop) return;
        if (error) {
          setErrEquity(formatSbError("bot_run_equity_current", error));
          return;
        }
        setErrEquity(null);
        setRunEquity(data as any);
      } catch (e: any) {
        if (stop) return;
        setErrEquity(
          `bot_run_equity_current unexpected: ${String(e?.message ?? e)}`
        );
      }
    }
    loadEquity();
    const i = setInterval(loadEquity, 3000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [runId]); // CHANGED

  /* ================= SETTLEMENTS ================= */
  useEffect(() => {
    let stop = false;
    async function loadSettlements() {
      try {
        if (!runId) {
          setSettlements([]);
          return;
        }
        const { data, error } = await supabase
          .from("bot_settlements")
          .select("*")
          .eq("run_id", runId)
          .order("settled_at", { ascending: false })
          .limit(50);

        if (stop) return;
        if (error) {
          setErrSettlements(formatSbError("bot_settlements", error));
          return;
        }
        setErrSettlements(null);
        setSettlements((data || []) as any);
      } catch (e: any) {
        if (stop) return;
        setErrSettlements(
          `bot_settlements unexpected: ${String(e?.message ?? e)}`
        );
      }
    }
    loadSettlements();
    const i = setInterval(loadSettlements, 5000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [runId]);

  /* ================= TICKS ================= */
  useEffect(() => {
    let stop = false;
    async function loadTicks() {
      try {
        if (!runId) {
          setTicks([]);
          return;
        }
        const { data, error } = await supabase
          .from("bot_ticks")
          .select("*")
          .eq("run_id", runId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (stop) return;
        if (error) {
          setErrTicks(formatSbError("bot_ticks", error));
          return;
        }
        setErrTicks(null);
        setTicks((data || []) as any);
      } catch (e: any) {
        if (stop) return;
        setErrTicks(`bot_ticks unexpected: ${String(e?.message ?? e)}`);
      }
    }
    loadTicks();
    const i = setInterval(loadTicks, 3000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [runId]);

  /* ================= VALUATIONS ================= */
  useEffect(() => {
    let stop = false;
    async function loadValuations() {
      try {
        if (!runId) {
          setValuations([]);
          return;
        }
        const { data, error } = await supabase
          .from("bot_unrealized_valuations")
          .select(
            "slug,ts,ts_bucket,unrealized_pnl,liquidation_value_net,pricing_quality,yes_bid_missing,no_bid_missing,run_id"
          )
          .eq("run_id", runId)
          .order("ts", { ascending: false })
          .limit(500);

        if (stop) return;
        if (error) {
          setErrValuations(formatSbError("bot_unrealized_valuations", error));
          return;
        }
        setErrValuations(null);
        setValuations((data || []) as any);
      } catch (e: any) {
        if (stop) return;
        setErrValuations(
          `bot_unrealized_valuations unexpected: ${String(e?.message ?? e)}`
        );
      }
    }
    loadValuations();
    const i = setInterval(loadValuations, 3000);
    return () => {
      stop = true;
      clearInterval(i);
    };
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

  const netEquity = runEquity?.net_equity ?? 0; // CHANGED

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6">
      <div className="grid grid-cols-5 gap-4 mb-8">
        <Metric label="Bankroll" value={bankroll?.bankroll.toFixed(2)} />
        <Metric label="Open Position Cost" value={openPositionCost.toFixed(2)} />
        <Metric label="Estimated Return" value={estimatedReturn.toFixed(2)} />
        <Metric label="Realized PnL" value={realizedPnl.toFixed(2)} />
        <Metric
          label="Net Equity"
          value={runEquity ? runEquity.net_equity.toFixed(2) : "--"} // CHANGED
        />
      </div>
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

function formatSbError(table: string, error: any): string {
  const msg = error?.message ? String(error.message) : String(error);
  const code = error?.code ? String(error.code) : "";
  const status = error?.status ? String(error.status) : "";
  return `${table}: ${msg}${code ? ` | code=${code}` : ""}${
    status ? ` | status=${status}` : ""
  }`;
}
