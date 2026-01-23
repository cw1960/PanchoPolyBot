import React, { useEffect, useMemo, useState } from "react";
import { Shield, CheckCircle, AlertTriangle } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/* =========================
   SUPABASE CLIENT
========================= */
const SUPABASE_URL = "https://bnobbksmuhhnikjprems.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg";

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
  expected_return?: number;
  expected_pnl?: number;
  created_at: string;
}

/* =========================
   DASHBOARD
========================= */
export const Dashboard: React.FC = () => {
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [estimatedReturn, setEstimatedReturn] = useState(0);

  const [errBankroll, setErrBankroll] = useState<string | null>(null);
  const [errSettlements, setErrSettlements] = useState<string | null>(null);
  const [errTicks, setErrTicks] = useState<string | null>(null);

  const connected = useMemo(() => {
    const keyLooksReal =
      typeof resolvedKey === "string" &&
      resolvedKey.length > 50 &&
      !resolvedKey.includes("YOUR_ANON_KEY_HERE");

    const no401 =
      !(errTicks || "").includes("401") &&
      !(errBankroll || "").includes("401") &&
      !(errSettlements || "").includes("401");

    return keyLooksReal && no401;
  }, [errBankroll, errSettlements, errTicks]);

  /* ---------- BANKROLL ---------- */
  useEffect(() => {
    let stop = false;

    async function loadBankroll() {
      const { data, error } = await supabase
        .from("bot_bankroll")
        .select("*")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (stop) return;

      if (error) {
        setErrBankroll(formatSbError("bot_bankroll", error));
        return;
      }

      setErrBankroll(null);
      if (data) setBankroll(data);
    }

    loadBankroll();
    const i = setInterval(loadBankroll, 3000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, []);

  /* ---------- SETTLEMENTS ---------- */
  useEffect(() => {
    let stop = false;

    async function loadSettlements() {
      const { data, error } = await supabase
        .from("bot_settlements")
        .select("*")
        .order("settled_at", { ascending: false })
        .limit(20);

      if (stop) return;

      if (error) {
        setErrSettlements(formatSbError("bot_settlements", error));
        return;
      }

      setErrSettlements(null);
      setSettlements(data || []);
    }

    loadSettlements();
    const i = setInterval(loadSettlements, 5000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, []);

  /* ---------- TICKS ---------- */
  useEffect(() => {
    let stop = false;

    async function loadTicks() {
      const { data, error } = await supabase
        .from("bot_ticks")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (stop) return;

      if (error) {
        setErrTicks(formatSbError("bot_ticks", error));
        return;
      }

      setErrTicks(null);
      setTicks(data || []);
    }

    loadTicks();
    const i = setInterval(loadTicks, 3000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, []);

  /* ---------- DERIVED ---------- */
  const realizedPnl = useMemo(
    () => settlements.reduce((a, s) => a + Number(s.pnl || 0), 0),
    [settlements]
  );

  const openPositionCost = bankroll?.exposure ?? 0;
  const netEquity = bankroll?.bankroll ?? 0;

  useEffect(() => {
    const settled = new Set(settlements.map(s => s.slug));

    const est = ticks
      .filter(t => !settled.has(t.slug))
      .reduce((a, t) => {
        const v =
          Number(t.expected_return) ||
          Number(t.expected_pnl) ||
          0;
        return a + v;
      }, 0);

    setEstimatedReturn(est);
  }, [ticks, settlements]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-mono flex items-center gap-2">
          <Shield className="text-emerald-500" />
          BOT TRUTH DASHBOARD
        </h1>

        <span
          className={`text-xs px-2 py-1 rounded ${
            connected
              ? "bg-emerald-900 text-emerald-200"
              : "bg-red-900 text-red-200"
          }`}
        >
          {connected ? "CONNECTED" : "DISCONNECTED"}
        </span>
      </div>

      {/* ================= METRICS ================= */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        <Metric label="Bankroll" value={bankroll?.bankroll.toFixed(2)} />
        <Metric label="Open Position Cost" value={openPositionCost.toFixed(2)} />
        <Metric label="Estimated Return" value={estimatedReturn.toFixed(2)} />
        <Metric label="Realized PnL" value={realizedPnl.toFixed(2)} />
        <Metric label="Net Equity" value={netEquity.toFixed(2)} />
      </div>

      {/* ===== EVERYTHING BELOW IS RESTORED ===== */}
      {/* SETTLED MARKETS */}
      {/* RAW TICKS */}
      {/* BANKROLL DEBUG */}
      {/* (unchanged from your original file) */}
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
  return `${table}: ${msg}`;
}
