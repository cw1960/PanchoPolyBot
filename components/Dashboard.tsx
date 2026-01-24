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

/* =========================
   DASHBOARD
========================= */
export const Dashboard: React.FC = () => {
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);

  // NEW: active run id (run isolation)
  const [runId, setRunId] = useState<string | null>(null);
  const [errRun, setErrRun] = useState<string | null>(null);

  // Connection / debugging truth (so you’re not guessing)
  const [errBankroll, setErrBankroll] = useState<string | null>(null);
  const [errSettlements, setErrSettlements] = useState<string | null>(null);
  const [errTicks, setErrTicks] = useState<string | null>(null);

  const connected = useMemo(() => {
    // “Connected” means: we are successfully reading at least ticks,
    // and we have a valid key (not placeholder).
    const keyLooksReal =
      typeof resolvedKey === "string" &&
      resolvedKey.length > 50 &&
      !resolvedKey.includes("PASTE_YOUR_REAL_ANON_KEY_HERE") &&
      !resolvedKey.includes("YOUR_ANON_KEY_HERE");

    const no401 =
      !(errTicks || "").includes("401") &&
      !(errBankroll || "").includes("401") &&
      !(errSettlements || "").includes("401") &&
      !(errRun || "").includes("401");

    return keyLooksReal && no401;
  }, [errBankroll, errSettlements, errTicks, errRun]);

  /* ---------- ACTIVE RUN (RUN ISOLATION) ---------- */
  useEffect(() => {
    let stop = false;

    async function loadRunId() {
      try {
        const { data, error } = await supabase
          .from("bot_runs")
          .select("run_id, status, created_at")
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

    loadRunId();
    const i = setInterval(loadRunId, 5000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, []);

  /* ---------- BANKROLL (LIVE SNAPSHOT) ---------- */
  useEffect(() => {
    let stop = false;

    async function loadBankroll() {
      try {
        if (!runId) {
          // No run means we cannot scope queries correctly.
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

  /* ---------- SETTLEMENTS (REALIZED PNL) ---------- */
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
          .limit(20);

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

  /* ---------- TICKS (RAW TELEMETRY) ---------- */
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

  /* ---------- DERIVED METRICS ---------- */
  const realizedPnl = useMemo(
    () => settlements.reduce((a, s) => a + Number(s.pnl || 0), 0),
    [settlements]
  );

  // NEW: Estimated Return (sum of expected_pnl over the currently loaded ticks)
  const estimatedReturn = useMemo(() => {
    return ticks.reduce((a, t) => a + Number(t.expected_pnl || 0), 0);
  }, [ticks]);

  // IMPORTANT: your engine currently writes `exposure` = OPEN POSITION COST (money spent),
  // NOT unrealized PnL.
  const openPositionCost = bankroll?.exposure ?? 0;

  // Net equity is NOT bankroll + cost. Until we compute mark-to-market, equity = bankroll.
  const netEquity = bankroll?.bankroll ?? 0;

  const banner = useMemo(() => {
    const keyLooksPlaceholder =
      resolvedKey.includes("PASTE_YOUR_REAL_ANON_KEY_HERE") ||
      resolvedKey.includes("YOUR_ANON_KEY_HERE");
    if (keyLooksPlaceholder) {
      return {
        kind: "bad" as const,
        text:
          "Dashboard is using a placeholder SUPABASE_ANON_KEY. Paste your real anon key. (401 is guaranteed until you do.)",
      };
    }

    const any401 =
      (errTicks || "").includes("401") ||
      (errBankroll || "").includes("401") ||
      (errSettlements || "").includes("401") ||
      (errRun || "").includes("401");

    if (any401) {
      return {
        kind: "bad" as const,
        text:
          "Supabase is returning 401 (unauthorized). Your anon key is missing/invalid for this project.",
      };
    }

    const any403 =
      (errTicks || "").includes("403") ||
      (errBankroll || "").includes("403") ||
      (errSettlements || "").includes("403") ||
      (errRun || "").includes("403");

    if (any403) {
      return {
        kind: "warn" as const,
        text:
          "Supabase is returning 403 (forbidden). This is RLS/policy. The key is valid but reads are blocked.",
      };
    }

    if (errRun) {
      return {
        kind: "warn" as const,
        text:
          "Dashboard cannot resolve active RUNNING run_id from bot_runs. Telemetry is run-scoped now, so metrics will remain empty until a RUNNING run exists.",
      };
    }

    if (errTicks || errBankroll || errSettlements) {
      return {
        kind: "warn" as const,
        text:
          "Dashboard is running but at least one query is failing. Scroll down to see exact errors.",
      };
    }

    if (!runId) {
      return {
        kind: "warn" as const,
        text:
          "No active RUNNING run_id found in bot_runs. Create/start a run to see live telemetry.",
      };
    }

    return { kind: "ok" as const, text: "Supabase reads OK." };
  }, [errBankroll, errSettlements, errTicks, errRun, runId]);

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

      {/* STATUS BANNER (THIS IS THE “NO GUESSING” PART) */}
      <div
        className={`mb-6 rounded border p-3 text-sm ${
          banner.kind === "ok"
            ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
            : banner.kind === "warn"
            ? "border-yellow-800 bg-yellow-950/30 text-yellow-200"
            : "border-red-800 bg-red-950/30 text-red-200"
        }`}
      >
        <div className="flex items-center gap-2">
          {banner.kind === "ok" ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <AlertTriangle className="w-4 h-4" />
          )}
          <div>{banner.text}</div>
        </div>
        <div className="mt-2 text-xs opacity-80 font-mono">
          url={resolvedUrl} | keyLen={resolvedKey?.length ?? 0}
          {runId ? ` | run_id=${runId}` : ""}
        </div>
      </div>

      {/* ================= METRICS ================= */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        <Metric
          label="Bankroll"
          value={bankroll ? bankroll.bankroll.toFixed(2) : "--"}
        />
        <Metric label="Open Position Cost" value={openPositionCost.toFixed(2)} />
        <Metric label="Estimated Return" value={estimatedReturn.toFixed(2)} />
        <Metric label="Realized PnL" value={realizedPnl.toFixed(2)} />
        <Metric label="Net Equity" value={netEquity.toFixed(2)} />
      </div>

      <div className="text-[11px] text-zinc-500 mb-6">
        *Your current engine writes “exposure” as open-position cost (not mark-to-market).
        If you want true unrealized PnL, we’ll compute it from live prices later.
      </div>

      {/* ================= SETTLED MARKETS ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4 mb-8">
        <h2 className="text-sm text-zinc-400 mb-2 flex items-center gap-2">
          <CheckCircle className="text-emerald-400" />
          Resolved Markets
        </h2>
        {errSettlements && (
          <ErrorBox title="bot_settlements error" text={errSettlements} />
        )}
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
                  <td className="p-2 truncate max-w-[320px]">{s.slug}</td>
                  <td className="p-2 text-center">{s.final_outcome}</td>
                  <td
                    className={`p-2 text-center ${
                      s.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {Number(s.pnl).toFixed(2)}
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
                    No markets settled yet (this means bot_settlements has 0 rows)
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
        {errTicks && <ErrorBox title="bot_ticks error" text={errTicks} />}
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
                <td className="p-2 truncate max-w-[320px]">{t.slug}</td>
                <td className="p-2 text-center">
                  {Number(t.edge_after_fees).toFixed(4)}
                </td>
                <td className="p-2 text-center">
                  {Number(t.recommended_size).toFixed(2)}
                </td>
              </tr>
            ))}
            {ticks.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-zinc-500">
                  No tick rows returned yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ================= BANKROLL DEBUG ================= */}
      <div className="mt-8">
        <h2 className="text-xs text-zinc-500 mb-2">Bankroll Snapshot Debug</h2>
        {errBankroll && <ErrorBox title="bot_bankroll error" text={errBankroll} />}
        {errRun && <ErrorBox title="bot_runs error" text={errRun} />}
        <div className="text-xs font-mono text-zinc-400">
          Latest bankroll row ts: {bankroll?.ts ?? "--"}
        </div>
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
