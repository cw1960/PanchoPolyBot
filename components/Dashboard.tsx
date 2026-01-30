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
interface RunRow {
  run_id: string;
  status: string;
  created_at: string;
}

interface BankrollRow {
  bankroll: number;
  cap_per_market: number;
  exposure: number;
  ts: string;
  run_id?: string;
  source?: string;
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
  expected_pnl?: number; // optional
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

interface LiveStateRow {
  ts: string;
  run_id: string;
  strategy_equity: number;
  open_position_cost: number;
  estimated_return: number;
  realized_pnl: number;
  cap_per_market: number;
  exposure: number;
}

/* =========================
  DASHBOARD
========================= */
export const Dashboard: React.FC = () => {
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [valuations, setValuations] = useState<ValuationRow[]>([]);

  // ✅ Live truth row for the 4 top panels
  const [live, setLive] = useState<LiveStateRow | null>(null);

  // Runs + selection
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);

  // Cap control (dashboard)
  const [capInput, setCapInput] = useState<number>(500);
  const [capMsg, setCapMsg] = useState<string | null>(null);

  // Prevent “cap resets to 250” while you’re editing
  const [capDirty, setCapDirty] = useState<boolean>(false);

  // Connection / debugging truth (so you’re not guessing)
  const [errRun, setErrRun] = useState<string | null>(null);
  const [errBankroll, setErrBankroll] = useState<string | null>(null);
  const [errSettlements, setErrSettlements] = useState<string | null>(null);
  const [errTicks, setErrTicks] = useState<string | null>(null);
  const [errValuations, setErrValuations] = useState<string | null>(null);
  const [errLive, setErrLive] = useState<string | null>(null);

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
      (errLive || "").includes("401");

    return keyLooksReal && !any401;
  }, [errRun, errBankroll, errSettlements, errTicks, errValuations, errLive]);

  /* =========================
    RUN DISCOVERY + SELECTOR
  ========================= */
  useEffect(() => {
    let stop = false;

    async function loadRuns() {
      try {
        const { data, error } = await supabase
          .from("bot_runs")
          .select("run_id,status,created_at")
          .order("created_at", { ascending: false })
          .limit(15);

        if (stop) return;

        if (error) {
          setErrRun(formatSbError("bot_runs", error));
          setRuns([]);
          return;
        }

        setErrRun(null);
        const rows = (data || []) as any as RunRow[];
        setRuns(rows);

        if (!runId) {
          const running = rows.find((r) => String(r.status).toUpperCase() === "RUNNING");
          const fallback = rows[0];
          const next = (running?.run_id || fallback?.run_id || null) as any;
          setRunId(next);
        }
      } catch (e: any) {
        if (stop) return;
        setErrRun(`bot_runs unexpected: ${String(e?.message ?? e)}`);
        setRuns([]);
      }
    }

    loadRuns();
    const i = setInterval(loadRuns, 5000);
    return () => {
      stop = true;
      clearInterval(i);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // When runId changes, reset state so you don’t see stale numbers.
  useEffect(() => {
    setBankroll(null);
    setSettlements([]);
    setTicks([]);
    setValuations([]);
    setLive(null);

    setErrBankroll(null);
    setErrSettlements(null);
    setErrTicks(null);
    setErrValuations(null);
    setErrLive(null);

    setCapMsg(null);
    setCapDirty(false);
  }, [runId]);

  // Sync cap input from latest bankroll row (ONLY if you are not currently editing)
  useEffect(() => {
    if (capDirty) return;
    if (bankroll?.cap_per_market != null && Number.isFinite(Number(bankroll.cap_per_market))) {
      setCapInput(Number(bankroll.cap_per_market));
    }
  }, [bankroll, capDirty]);

  /* =========================
    DATA LOADERS (run-scoped)
  ========================= */

  // Bankroll (run-scoped)
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
        setBankroll((data as any) ?? null);
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

  // ✅ Live truth loader (run-scoped)
  useEffect(() => {
    let stop = false;
    async function loadLive() {
      try {
        if (!runId) {
          setLive(null);
          return;
        }

        const { data, error } = await supabase
          .from("bot_live_state")
          .select("*")
          .eq("run_id", runId)
          .maybeSingle();

        if (stop) return;

        if (error) {
          setErrLive(formatSbError("bot_live_state", error));
          return;
        }

        setErrLive(null);
        setLive((data as any) ?? null);
      } catch (e: any) {
        if (stop) return;
        setErrLive(`bot_live_state unexpected: ${String(e?.message ?? e)}`);
      }
    }

    loadLive();
    const i = setInterval(loadLive, 2000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [runId]);

  // Settlements (run-scoped)
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
        setErrSettlements(`bot_settlements unexpected: ${String(e?.message ?? e)}`);
      }
    }

    loadSettlements();
    const i = setInterval(loadSettlements, 5000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [runId]);

  // Ticks (run-scoped)
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

  // Valuations (run-scoped)
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
        setErrValuations(`bot_unrealized_valuations unexpected: ${String(e?.message ?? e)}`);
      }
    }

    loadValuations();
    const i = setInterval(loadValuations, 3000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [runId]);

  /* =========================
    CAP CONTROL ACTION
  ========================= */
  async function writeCapPerMarket() {
    if (!runId) {
      setCapMsg("No run selected.");
      return;
    }
    if (!bankroll) {
      setCapMsg("No bankroll row loaded yet (wait 1–2 seconds).");
      return;
    }
    if (!Number.isFinite(Number(capInput)) || Number(capInput) <= 0) {
      setCapMsg("Invalid cap value.");
      return;
    }

    try {
      const payload = {
        run_id: runId,
        ts: new Date().toISOString(),
        bankroll: Number(bankroll.bankroll),
        exposure: Number(bankroll.exposure),
        cap_per_market: Number(capInput),
        source: "dashboard", // REQUIRED BY YOUR RLS POLICY
      };

      const { error } = await supabase.from("bot_bankroll").insert(payload as any);

      if (error) {
        setCapMsg(`Write failed: ${error.message}`);
        return;
      }

      setCapDirty(false);
      setCapMsg(
        `OK: cap_per_market set to ${Number(capInput).toFixed(
          2
        )} (new bankroll row inserted)`
      );
    } catch (e: any) {
      setCapMsg(`Write failed: ${String(e?.message ?? e)}`);
    }
  }

  /* =========================
    METRICS
    IMPORTANT:
    These top panels now come from bot_live_state (authoritative live truth).
    If bot_live_state is not being written yet, they will show "--".
  ========================= */
  const strategyEquity = live?.strategy_equity ?? null;
  const openPositionCost = live?.open_position_cost ?? null;
  const estimatedReturn = live?.estimated_return ?? null;
  const realizedPnl = live?.realized_pnl ?? null;

  // Compute latest valuation per slug (client-side) — still useful for the text line below
  const totalUnrealizedPnl = useMemo(() => {
    const latestBySlug = new Map<string, ValuationRow>();
    for (const v of valuations) {
      if (!latestBySlug.has(v.slug)) latestBySlug.set(v.slug, v);
    }
    let sum = 0;
    for (const v of latestBySlug.values()) sum += Number(v.unrealized_pnl || 0);
    return sum;
  }, [valuations]);

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
      (errRun || "").includes("401") ||
      (errTicks || "").includes("401") ||
      (errBankroll || "").includes("401") ||
      (errSettlements || "").includes("401") ||
      (errValuations || "").includes("401") ||
      (errLive || "").includes("401");

    if (any401) {
      return {
        kind: "bad" as const,
        text:
          "Supabase is returning 401 (unauthorized). Your anon key is missing/invalid for this project.",
      };
    }

    const any403 =
      (errRun || "").includes("403") ||
      (errTicks || "").includes("403") ||
      (errBankroll || "").includes("403") ||
      (errSettlements || "").includes("403") ||
      (errValuations || "").includes("403") ||
      (errLive || "").includes("403");

    if (any403) {
      return {
        kind: "warn" as const,
        text:
          "Supabase is returning 403 (forbidden). This is RLS/policy. The key is valid but reads are blocked.",
      };
    }

    if (!runId) {
      return {
        kind: "warn" as const,
        text: "No run selected (bot_runs empty or not readable).",
      };
    }

    if (errRun || errTicks || errBankroll || errSettlements || errValuations || errLive) {
      return {
        kind: "warn" as const,
        text:
          "Dashboard is running but at least one query is failing. Scroll down to see exact errors.",
      };
    }

    return { kind: "ok" as const, text: "Supabase reads OK." };
  }, [errRun, errBankroll, errSettlements, errTicks, errValuations, errLive, runId]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-mono flex items-center gap-2">
          <Shield className="text-emerald-500" />
          BOT TRUTH DASHBOARD
        </h1>
        <span
          className={`text-xs px-2 py-1 rounded ${
            connected ? "bg-emerald-900 text-emerald-200" : "bg-red-900 text-red-200"
          }`}
        >
          {connected ? "CONNECTED" : "DISCONNECTED"}
        </span>
      </div>

      {/* STATUS BANNER */}
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
          {live?.ts ? ` | live_ts=${new Date(live.ts).toISOString()}` : ""}
        </div>

        {/* RUN SELECTOR */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <div className="font-mono text-zinc-400">Run:</div>
          <select
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
            value={runId ?? ""}
            onChange={(e) => setRunId(e.target.value || null)}
          >
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.status} | {r.run_id.slice(0, 8)}… | {new Date(r.created_at).toLocaleString()}
              </option>
            ))}
            {runs.length === 0 && <option value="">(no runs)</option>}
          </select>
        </div>
      </div>

      {/* ================= METRICS ================= */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Metric
          label="Strategy Equity"
          value={strategyEquity == null ? "--" : Number(strategyEquity).toFixed(2)}
        />
        <Metric
          label="Open Position Cost"
          value={openPositionCost == null ? "--" : Number(openPositionCost).toFixed(2)}
        />
        <Metric
          label="Estimated Return"
          value={estimatedReturn == null ? "--" : Number(estimatedReturn).toFixed(2)}
        />
        <Metric
          label="Realized PnL"
          value={realizedPnl == null ? "--" : Number(realizedPnl).toFixed(2)}
        />
      </div>

      <div className="text-[11px] text-zinc-500 mb-6">
        Unrealized PnL estimator: conservative bid-side liquidation value minus fee-equivalent taker fee estimate (15m crypto).
        <span className="ml-2 text-zinc-600">(uPnL rows loaded: {valuations.length})</span>
        <span className="ml-2 text-zinc-600">(total uPnL latest-by-slug: {totalUnrealizedPnl.toFixed(4)})</span>
      </div>

      {/* ================= CAP CONTROL ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4 mb-8">
        <h2 className="text-sm text-zinc-400 mb-3">Risk Control (cap_per_market)</h2>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs text-zinc-500 font-mono">
            current cap:{" "}
            <span className="text-zinc-200">
              {bankroll ? Number(bankroll.cap_per_market).toFixed(2) : "--"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-zinc-200 px-2 py-1 rounded text-xs"
              onClick={() => {
                setCapDirty(true);
                setCapInput(250);
              }}
            >
              250
            </button>
            <button
              className="bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-zinc-200 px-2 py-1 rounded text-xs"
              onClick={() => {
                setCapDirty(true);
                setCapInput(500);
              }}
            >
              500
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm w-32"
              value={capInput}
              onChange={(e) => {
                setCapDirty(true);
                setCapInput(Number(e.target.value));
              }}
              step={50}
              min={0}
            />
            <button
              onClick={writeCapPerMarket}
              className="bg-emerald-900 hover:bg-emerald-800 text-emerald-200 px-3 py-1 rounded text-xs"
            >
              Set cap_per_market
            </button>
          </div>
        </div>

        <div className="text-[11px] text-zinc-500 mt-2">
          This inserts a new <span className="font-mono">bot_bankroll</span> row with the chosen cap. Stop the bot before changing.
        </div>

        {capMsg && (
          <div className="mt-2 text-[11px] font-mono text-zinc-300">
            {capMsg}
          </div>
        )}
      </div>

      {/* ================= SETTLED MARKETS ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4 mb-8">
        <h2 className="text-sm text-zinc-400 mb-2 flex items-center gap-2">
          <CheckCircle className="text-emerald-400" />
          Resolved Markets
        </h2>
        {errSettlements && <ErrorBox title="bot_settlements error" text={errSettlements} />}
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
                      Number(s.pnl) >= 0 ? "text-emerald-400" : "text-red-400"
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
                <td className="p-2">{new Date(t.created_at).toLocaleTimeString()}</td>
                <td className="p-2 truncate max-w-[320px]">{t.slug}</td>
                <td className="p-2 text-center">{Number(t.edge_after_fees).toFixed(4)}</td>
                <td className="p-2 text-center">{Number(t.recommended_size).toFixed(2)}</td>
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

      {/* ================= UNREALIZED VALUATIONS ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4 mt-8">
        <h2 className="text-xs text-zinc-500 mb-2">Unrealized Valuations (latest by slug)</h2>
        {errValuations && <ErrorBox title="bot_unrealized_valuations error" text={errValuations} />}
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-zinc-900 sticky top-0">
              <tr>
                <th className="p-2 text-left">time</th>
                <th className="p-2 text-left">market</th>
                <th className="p-2">uPnL</th>
                <th className="p-2">quality</th>
              </tr>
            </thead>
            <tbody>
              {valuations.slice(0, 20).map((v, i) => (
                <tr key={i} className="border-t border-zinc-800">
                  <td className="p-2">{new Date(v.ts).toLocaleTimeString()}</td>
                  <td className="p-2 truncate max-w-[320px]">{v.slug}</td>
                  <td
                    className={`p-2 text-center ${
                      Number(v.unrealized_pnl) >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {Number(v.unrealized_pnl).toFixed(4)}
                  </td>
                  <td className="p-2 text-center">{v.pricing_quality}</td>
                </tr>
              ))}
              {valuations.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-zinc-500">
                    No valuation rows yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= DEBUG ================= */}
      <div className="mt-8">
        <h2 className="text-xs text-zinc-500 mb-2">Debug</h2>
        {errRun && <ErrorBox title="bot_runs error" text={errRun} />}
        {errBankroll && <ErrorBox title="bot_bankroll error" text={errBankroll} />}
        {errLive && <ErrorBox title="bot_live_state error" text={errLive} />}
        <div className="text-xs font-mono text-zinc-400">
          Selected run_id: {runId ?? "--"}
        </div>
        <div className="text-xs font-mono text-zinc-400">
          Latest bankroll row ts: {bankroll?.ts ?? "--"}
        </div>
        <div className="text-xs font-mono text-zinc-400">
          Live state ts: {live?.ts ?? "--"}
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
  return `${table}: ${msg}${code ? ` | code=${code}` : ""}${status ? ` | status=${status}` : ""}`;
}
