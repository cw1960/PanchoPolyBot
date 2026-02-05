// Dashboard.tsx - Updated with New Metrics
import React, { useEffect, useMemo, useState } from "react";
import { Shield, CheckCircle, AlertTriangle, TrendingUp, TrendingDown, Clock, DollarSign } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/* ========================= SUPABASE CLIENT ========================= */
const SUPABASE_URL = "https://bnobbksmuhhnikjprems.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg";

const resolvedUrl = (globalThis as any)?.SUPABASE_URL || (globalThis as any)?.window?.SUPABASE_URL || SUPABASE_URL;
const resolvedKey = (globalThis as any)?.SUPABASE_ANON_KEY || (globalThis as any)?.window?.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
const supabase = createClient(resolvedUrl, resolvedKey);

/* ========================= TYPES ========================= */
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
  expected_pnl?: number;
  spread?: number;
  spread_percent?: number;
  expected_value?: number;
  is_profitable?: boolean;
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

// NEW: Oracle Lag Types
interface OracleLagRow {
  id: number;
  run_id: string;
  lag_ms: number;
  source: string;
  market_slug?: string;
  exchange_price?: number;
  polymarket_price?: number;
  change_percent?: number;
  ts: string;
}

// NEW: Arbitrage Types
interface ArbitrageRow {
  id: number;
  run_id: string;
  market_slug: string;
  yes_price: number;
  no_price: number;
  sum: number;
  profit: number;
  profit_percent: number;
  executed: boolean;
  executed_at?: string;
  profit_realized?: number;
  ts: string;
}

// NEW: Strategy Performance Types
interface StrategyPerformanceRow {
  id: number;
  run_id: string;
  strategy_name: string;
  allocation: number;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  roi: number;
  total_invested: number;
  total_returned: number;
  ts: string;
}

/* ========================= DASHBOARD ========================= */
export const Dashboard: React.FC = () => {
  // Existing state
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [valuations, setValuations] = useState<ValuationRow[]>([]);
  const [lifetimeStartBankroll, setLifetimeStartBankroll] = useState<number | null>(null);
  const [lifetimeLatestAnyBankroll, setLifetimeLatestAnyBankroll] = useState<BankrollRow | null>(null);
  const [lifetimeRealizedPnl, setLifetimeRealizedPnl] = useState<number>(0);
  const [errLifetime, setErrLifetime] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [capInput, setCapInput] = useState<number>(500);
  const [capMsg, setCapMsg] = useState<string | null>(null);
  const [errRun, setErrRun] = useState<string | null>(null);
  const [errBankroll, setErrBankroll] = useState<string | null>(null);
  const [errSettlements, setErrSettlements] = useState<string | null>(null);
  const [errTicks, setErrTicks] = useState<string | null>(null);
  const [errValuations, setErrValuations] = useState<string | null>(null);

  // NEW: Oracle Lag State
  const [oracleLag, setOracleLag] = useState<OracleLagRow[]>([]);
  const [errOracleLag, setErrOracleLag] = useState<string | null>(null);

  // NEW: Arbitrage State
  const [arbitrageOpportunities, setArbitrageOpportunities] = useState<ArbitrageRow[]>([]);
  const [errArbitrage, setErrArbitrage] = useState<string | null>(null);

  // NEW: Strategy Performance State
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformanceRow[]>([]);
  const [errStrategyPerformance, setErrStrategyPerformance] = useState<string | null>(null);

  const connected = useMemo(() => {
    const keyLooksReal = typeof resolvedKey === "string" && resolvedKey.length > 50 && !resolvedKey.includes("PASTE_YOUR_REAL_ANON_KEY_HERE") && !resolvedKey.includes("YOUR_ANON_KEY_HERE");
    const any401 = (errRun || "").includes("401") || (errTicks || "").includes("401") || (errBankroll || "").includes("401") || (errSettlements || "").includes("401") || (errValuations || "").includes("401") || (errLifetime || "").includes("401") || (errOracleLag || "").includes("401") || (errArbitrage || "").includes("401") || (errStrategyPerformance || "").includes("401");
    return keyLooksReal && !any401;
  }, [errRun, errBankroll, errSettlements, errTicks, errValuations, errLifetime, errOracleLag, errArbitrage, errStrategyPerformance]);

  /* ========================= RUN DISCOVERY + SELECTOR ========================= */
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
    return () => { stop = true; clearInterval(i); };
  }, [runId]);

  useEffect(() => {
    setBankroll(null);
    setSettlements([]);
    setTicks([]);
    setValuations([]);
    setOracleLag([]);
    setArbitrageOpportunities([]);
    setStrategyPerformance([]);
    setErrBankroll(null);
    setErrSettlements(null);
    setErrTicks(null);
    setErrValuations(null);
    setErrOracleLag(null);
    setErrArbitrage(null);
    setErrStrategyPerformance(null);
    setCapMsg(null);
  }, [runId]);

  useEffect(() => {
    if (bankroll?.cap_per_market != null && Number.isFinite(Number(bankroll.cap_per_market))) {
      setCapInput(Number(bankroll.cap_per_market));
    }
  }, [bankroll]);

  /* ========================= DATA LOADERS (run-scoped) ========================= */
  // Bankroll (run-scoped)
  useEffect(() => {
    let stop = false;
    async function loadBankroll() {
      try {
        if (!runId) { setBankroll(null); return; }
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
    return () => { stop = true; clearInterval(i); };
  }, [runId]);

  // Settlements (run-scoped)
  useEffect(() => {
    let stop = false;
    async function loadSettlements() {
      try {
        if (!runId) { setSettlements([]); return; }
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
    return () => { stop = true; clearInterval(i); };
  }, [runId]);

  // Ticks (run-scoped)
  useEffect(() => {
    let stop = false;
    async function loadTicks() {
      try {
        if (!runId) { setTicks([]); return; }
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
    return () => { stop = true; clearInterval(i); };
  }, [runId]);

  // Valuations (run-scoped)
  useEffect(() => {
    let stop = false;
    async function loadValuations() {
      try {
        if (!runId) { setValuations([]); return; }
        const { data, error } = await supabase
          .from("bot_unrealized_valuations")
          .select("slug,ts,ts_bucket,unrealized_pnl,liquidation_value_net,pricing_quality,yes_bid_missing,no_bid_missing,run_id")
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
    return () => { stop = true; clearInterval(i); };
  }, [runId]);

  // NEW: Oracle Lag (run-scoped)
  useEffect(() => {
    let stop = false;
    async function loadOracleLag() {
      try {
        if (!runId) { setOracleLag([]); return; }
        const { data, error } = await supabase
          .from("bot_oracle_lag")
          .select("*")
          .eq("run_id", runId)
          .order("ts", { ascending: false })
          .limit(100);
        if (stop) return;
        if (error) {
          setErrOracleLag(formatSbError("bot_oracle_lag", error));
          return;
        }
        setErrOracleLag(null);
        setOracleLag((data || []) as any);
      } catch (e: any) {
        if (stop) return;
        setErrOracleLag(`bot_oracle_lag unexpected: ${String(e?.message ?? e)}`);
      }
    }
    loadOracleLag();
    const i = setInterval(loadOracleLag, 60000); // Every minute
    return () => { stop = true; clearInterval(i); };
  }, [runId]);

  // NEW: Arbitrage Opportunities (run-scoped)
  useEffect(() => {
    let stop = false;
    async function loadArbitrage() {
      try {
        if (!runId) { setArbitrageOpportunities([]); return; }
        const { data, error } = await supabase
          .from("bot_arbitrage_opportunities")
          .select("*")
          .eq("run_id", runId)
          .order("ts", { ascending: false })
          .limit(50);
        if (stop) return;
        if (error) {
          setErrArbitrage(formatSbError("bot_arbitrage_opportunities", error));
          return;
        }
        setErrArbitrage(null);
        setArbitrageOpportunities((data || []) as any);
      } catch (e: any) {
        if (stop) return;
        setErrArbitrage(`bot_arbitrage_opportunities unexpected: ${String(e?.message ?? e)}`);
      }
    }
    loadArbitrage();
    const i = setInterval(loadArbitrage, 10000); // Every 10 seconds
    return () => { stop = true; clearInterval(i); };
  }, [runId]);

  // NEW: Strategy Performance (run-scoped)
  useEffect(() => {
    let stop = false;
    async function loadStrategyPerformance() {
      try {
        if (!runId) { setStrategyPerformance([]); return; }
        const { data, error } = await supabase
          .from("bot_strategy_performance")
          .select("*")
          .eq("run_id", runId)
          .order("ts", { ascending: false })
          .limit(20);
        if (stop) return;
        if (error) {
          setErrStrategyPerformance(formatSbError("bot_strategy_performance", error));
          return;
        }
        setErrStrategyPerformance(null);
        setStrategyPerformance((data || []) as any);
      } catch (e: any) {
        if (stop) return;
        setErrStrategyPerformance(`bot_strategy_performance unexpected: ${String(e?.message ?? e)}`);
      }
    }
    loadStrategyPerformance();
    const i = setInterval(loadStrategyPerformance, 60000); // Every minute
    return () => { stop = true; clearInterval(i); };
  }, [runId]);

  /* ========================= LIFETIME LOADERS (cross-run) ========================= */
  useEffect(() => {
    let stop = false;
    async function loadLifetime() {
      try {
        const { data: startData, error: startErr } = await supabase
          .from("bot_bankroll")
          .select("bankroll,ts,source")
          .eq("source", "engine")
          .order("ts", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (stop) return;
        if (startErr) {
          setErrLifetime(formatSbError("lifetime(bot_bankroll start)", startErr));
        } else {
          const b0 = Number((startData as any)?.bankroll);
          setLifetimeStartBankroll(Number.isFinite(b0) ? b0 : 1000);
          setErrLifetime(null);
        }

        const { data: latestData, error: latestErr } = await supabase
          .from("bot_bankroll")
          .select("*")
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (stop) return;
        if (latestErr) {
          setErrLifetime(formatSbError("lifetime(bot_bankroll latest)", latestErr));
        } else {
          setLifetimeLatestAnyBankroll((latestData as any) ?? null);
          setErrLifetime(null);
        }

        const pageSize = 1000;
        const maxPages = 50;
        let from = 0;
        let total = 0;
        for (let page = 0; page < maxPages; page++) {
          const { data: pnlRows, error: pnlErr } = await supabase
            .from("bot_settlements")
            .select("pnl")
            .range(from, from + pageSize - 1);
          if (stop) return;
          if (pnlErr) {
            setErrLifetime(formatSbError("lifetime(bot_settlements pnl)", pnlErr));
            break;
          }
          const arr = (pnlRows || []) as any[];
          for (const r of arr) total += Number(r?.pnl || 0);
          if (arr.length < pageSize) {
            setLifetimeRealizedPnl(total);
            setErrLifetime(null);
            break;
          }
          from += pageSize;
        }
      } catch (e: any) {
        if (stop) return;
        setErrLifetime(`lifetime unexpected: ${String(e?.message ?? e)}`);
      }
    }
    loadLifetime();
    const i = setInterval(loadLifetime, 8000);
    return () => { stop = true; clearInterval(i); };
  }, []);

  /* ========================= CAP CONTROL ACTION ========================= */
  async function writeCapPerMarket() {
    if (!runId) { setCapMsg("No run selected."); return; }
    if (!bankroll) { setCapMsg("No bankroll row loaded yet (wait 1–2 seconds)."); return; }
    if (!Number.isFinite(Number(capInput)) || Number(capInput) <= 0) { setCapMsg("Invalid cap value."); return; }
    try {
      const payload = {
        run_id: runId,
        ts: new Date().toISOString(),
        bankroll: Number(bankroll.bankroll),
        exposure: Number(bankroll.exposure),
        cap_per_market: Number(capInput),
        source: "dashboard",
      };
      const { error } = await supabase.from("bot_bankroll").insert(payload as any);
      if (error) {
        setCapMsg(`Write failed: ${error.message}`);
        return;
      }
      setCapMsg(`OK: cap_per_market set to ${Number(capInput).toFixed(2)} (new bankroll row inserted)`);
    } catch (e: any) {
      setCapMsg(`Write failed: ${String(e?.message ?? e)}`);
    }
  }

  /* ========================= METRICS ========================= */
  const realizedPnl = useMemo(() => {
    return settlements.reduce((a, s) => a + Number(s.pnl || 0), 0);
  }, [settlements]);

  const estimatedReturn = useMemo(() => {
    const latestBySlug = new Map<string, Tick>();
    for (const t of ticks) {
      if (!latestBySlug.has(t.slug)) latestBySlug.set(t.slug, t);
    }
    let sum = 0;
    for (const t of latestBySlug.values()) sum += Number(t.expected_pnl || 0);
    return sum;
  }, [ticks]);

  const totalUnrealizedPnl = useMemo(() => {
    const latestBySlug = new Map<string, ValuationRow>();
    for (const v of valuations) {
      if (!latestBySlug.has(v.slug)) latestBySlug.set(v.slug, v);
    }
    let sum = 0;
    for (const v of latestBySlug.values()) sum += Number(v.unrealized_pnl || 0);
    return sum;
  }, [valuations]);

  const openPositionCost = bankroll?.exposure ?? 0;
  const lifetimeOpenPositionCost = lifetimeLatestAnyBankroll?.exposure ?? 0;

  const lifetimeEquity = useMemo(() => {
    const base = Number.isFinite(Number(lifetimeStartBankroll)) ? Number(lifetimeStartBankroll) : 1000;
    return base + Number(lifetimeRealizedPnl || 0);
  }, [lifetimeStartBankroll, lifetimeRealizedPnl]);

  // NEW: Oracle Lag Metrics
  const oracleLagStats = useMemo(() => {
    if (oracleLag.length === 0) return null;
    const recent = oracleLag.slice(0, 10);
    const avgLag = recent.reduce((sum, l) => sum + l.lag_ms, 0) / recent.length;
    const minLag = Math.min(...recent.map(l => l.lag_ms));
    const maxLag = Math.max(...recent.map(l => l.lag_ms));
    const bySource: Record<string, number[]> = {};
    for (const l of recent) {
      if (!bySource[l.source]) bySource[l.source] = [];
      bySource[l.source].push(l.lag_ms);
    }
    const sourceAverages: Record<string, number> = {};
    for (const [source, lags] of Object.entries(bySource)) {
      sourceAverages[source] = lags.reduce((sum, lag) => sum + lag, 0) / lags.length;
    }
    const edgeValid = avgLag >= 1000; // Edge valid if avg lag >= 1 second
    return { avgLag, minLag, maxLag, sourceAverages, edgeValid, count: recent.length };
  }, [oracleLag]);

  // NEW: Arbitrage Metrics
  const arbitrageStats = useMemo(() => {
    if (arbitrageOpportunities.length === 0) return null;
    const executed = arbitrageOpportunities.filter(a => a.executed);
    const totalProfit = executed.reduce((sum, a) => sum + Number(a.profit_realized || 0), 0);
    const successRate = arbitrageOpportunities.length > 0 ? (executed.length / arbitrageOpportunities.length) * 100 : 0;
    return {
      totalFound: arbitrageOpportunities.length,
      totalExecuted: executed.length,
      totalProfit,
      successRate,
      avgProfit: executed.length > 0 ? totalProfit / executed.length : 0,
    };
  }, [arbitrageOpportunities]);

  // NEW: Strategy Performance Metrics
  const latestStrategyPerformance = useMemo(() => {
    if (strategyPerformance.length === 0) return null;
    const byStrategy: Record<string, StrategyPerformanceRow> = {};
    for (const perf of strategyPerformance) {
      if (!byStrategy[perf.strategy_name] || new Date(perf.ts) > new Date(byStrategy[perf.strategy_name].ts)) {
        byStrategy[perf.strategy_name] = perf;
      }
    }
    return byStrategy;
  }, [strategyPerformance]);

  const banner = useMemo(() => {
    const keyLooksPlaceholder = resolvedKey.includes("PASTE_YOUR_REAL_ANON_KEY_HERE") || resolvedKey.includes("YOUR_ANON_KEY_HERE");
    if (keyLooksPlaceholder) {
      return { kind: "bad" as const, text: "Dashboard is using a placeholder SUPABASE_ANON_KEY. Paste your real anon key. (401 is guaranteed until you do.)" };
    }
    const any401 = (errRun || "").includes("401") || (errTicks || "").includes("401") || (errBankroll || "").includes("401") || (errSettlements || "").includes("401") || (errValuations || "").includes("401") || (errLifetime || "").includes("401") || (errOracleLag || "").includes("401") || (errArbitrage || "").includes("401") || (errStrategyPerformance || "").includes("401");
    if (any401) {
      return { kind: "bad" as const, text: "Supabase is returning 401 (unauthorized). Your anon key is missing/invalid for this project." };
    }
    const any403 = (errRun || "").includes("403") || (errTicks || "").includes("403") || (errBankroll || "").includes("403") || (errSettlements || "").includes("403") || (errValuations || "").includes("403") || (errLifetime || "").includes("403") || (errOracleLag || "").includes("403") || (errArbitrage || "").includes("403") || (errStrategyPerformance || "").includes("403");
    if (any403) {
      return { kind: "warn" as const, text: "Supabase is returning 403 (forbidden). This is RLS/policy. The key is valid but reads are blocked." };
    }
    if (!runId) {
      return { kind: "warn" as const, text: "No run selected (bot_runs empty or not readable)." };
    }
    if (errRun || errTicks || errBankroll || errSettlements || errValuations || errLifetime || errOracleLag || errArbitrage || errStrategyPerformance) {
      return { kind: "warn" as const, text: "Dashboard is running but at least one query is failing. Scroll down to see exact errors." };
    }
    return { kind: "ok" as const, text: "Supabase reads OK." };
  }, [errRun, errBankroll, errSettlements, errTicks, errValuations, errLifetime, errOracleLag, errArbitrage, errStrategyPerformance, runId]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-mono flex items-center gap-2">
          <Shield className="text-emerald-500" />
          BOT TRUTH DASHBOARD
        </h1>
        <span className={`text-xs px-2 py-1 rounded ${connected ? "bg-emerald-900 text-emerald-200" : "bg-red-900 text-red-200"}`}>
          {connected ? "CONNECTED" : "DISCONNECTED"}
        </span>
      </div>

      {/* STATUS BANNER */}
      <div className={`mb-6 rounded border p-3 text-sm ${banner.kind === "ok" ? "border-emerald-800 bg-emerald-950/40 text-emerald-200" : banner.kind === "warn" ? "border-yellow-800 bg-yellow-950/30 text-yellow-200" : "border-red-800 bg-red-950/30 text-red-200"}`}>
        <div className="flex items-center gap-2">
          {banner.kind === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          <div>{banner.text}</div>
        </div>
        <div className="mt-2 text-xs opacity-80 font-mono">
          url={resolvedUrl} | keyLen={resolvedKey?.length ?? 0} {runId ? ` | run_id=${runId}` : ""}
        </div>
        {/* RUN SELECTOR */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <div className="font-mono text-zinc-400">Run:</div>
          <select className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs" value={runId ?? ""} onChange={(e) => setRunId(e.target.value || null)}>
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
      <div className="grid grid-cols-4 gap-4 mb-3">
        <Metric label="Strategy Equity (Run)" value={bankroll ? Number(bankroll.bankroll).toFixed(2) : "--"} size="lg" />
        <Metric label="Open Position Cost (Run)" value={bankroll ? Number(openPositionCost).toFixed(2) : "--"} size="lg" />
        <Metric label="Estimated Return (Run)" value={Number(estimatedReturn).toFixed(2)} size="lg" />
        <Metric label="Realized PnL (Run)" value={Number(realizedPnl).toFixed(2)} size="lg" />
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6 opacity-80">
        <Metric label="Strategy Equity (Lifetime)" value={Number(lifetimeEquity).toFixed(2)} size="sm" />
        <Metric label="Open Position Cost (Lifetime)" value={Number(lifetimeOpenPositionCost).toFixed(2)} size="sm" />
        <Metric label="Estimated Return (Lifetime)" value={"N/A"} size="sm" />
        <Metric label="Realized PnL (Lifetime)" value={Number(lifetimeRealizedPnl).toFixed(2)} size="sm" />
      </div>

      <div className="text-[11px] text-zinc-500 mb-6">
        Unrealized PnL estimator: conservative bid-side liquidation value minus fee-equivalent taker fee estimate (15m crypto).
        <span className="ml-2 text-zinc-600">(uPnL rows loaded: {valuations.length})</span>
        <span className="ml-2 text-zinc-600">(total uPnL latest-by-slug: {totalUnrealizedPnl.toFixed(4)})</span>
      </div>

      {/* ================= NEW: ORACLE LAG MONITOR ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4 mb-8">
        <h2 className="text-sm text-zinc-400 mb-3 flex items-center gap-2">
          <Clock className="text-blue-400" />
          Oracle Lag Monitor
        </h2>
        {errOracleLag && <ErrorBox title="bot_oracle_lag error" text={errOracleLag} />}
        {oracleLagStats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-zinc-500">Average Lag</div>
              <div className="text-lg font-mono">{oracleLagStats.avgLag.toFixed(0)}ms</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Range</div>
              <div className="text-lg font-mono">{oracleLagStats.minLag}ms - {oracleLagStats.maxLag}ms</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Edge Status</div>
              <div className={`text-lg font-mono ${oracleLagStats.edgeValid ? "text-emerald-400" : "text-yellow-400"}`}>
                {oracleLagStats.edgeValid ? "✅ VALID" : "⚠️ DEGRADED"}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Measurements</div>
              <div className="text-lg font-mono">{oracleLagStats.count}</div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-zinc-500">No oracle lag data yet</div>
        )}
        {oracleLagStats && Object.keys(oracleLagStats.sourceAverages).length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-zinc-500 mb-2">Lag by Source:</div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(oracleLagStats.sourceAverages).map(([source, avg]) => (
                <div key={source} className="text-xs">
                  <span className="text-zinc-400">{source}:</span> <span className="font-mono">{avg.toFixed(0)}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ================= NEW: ARBITRAGE OPPORTUNITIES ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4 mb-8">
        <h2 className="text-sm text-zinc-400 mb-3 flex items-center gap-2">
          <DollarSign className="text-green-400" />
          Arbitrage Opportunities
        </h2>
        {errArbitrage && <ErrorBox title="bot_arbitrage_opportunities error" text={errArbitrage} />}
        {arbitrageStats ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
            <div>
              <div className="text-xs text-zinc-500">Found</div>
              <div className="text-lg font-mono">{arbitrageStats.totalFound}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Executed</div>
              <div className="text-lg font-mono">{arbitrageStats.totalExecuted}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Total Profit</div>
              <div className="text-lg font-mono text-emerald-400">${arbitrageStats.totalProfit.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Success Rate</div>
              <div className="text-lg font-mono">{arbitrageStats.successRate.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Avg Profit</div>
              <div className="text-lg font-mono">${arbitrageStats.avgProfit.toFixed(2)}</div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-zinc-500 mb-4">No arbitrage opportunities yet</div>
        )}
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-zinc-900 sticky top-0">
              <tr>
                <th className="p-2 text-left">Market</th>
                <th className="p-2">YES</th>
                <th className="p-2">NO</th>
                <th className="p-2">Profit %</th>
                <th className="p-2">Status</th>
                <th className="p-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {arbitrageOpportunities.slice(0, 10).map((a) => (
                <tr key={a.id} className="border-t border-zinc-800">
                  <td className="p-2 truncate max-w-[200px]">{a.market_slug}</td>
                  <td className="p-2 text-center">${Number(a.yes_price).toFixed(3)}</td>
                  <td className="p-2 text-center">${Number(a.no_price).toFixed(3)}</td>
                  <td className="p-2 text-center text-emerald-400">{Number(a.profit_percent).toFixed(2)}%</td>
                  <td className="p-2 text-center">{a.executed ? <span className="text-emerald-400">✅ Executed</span> : <span className="text-yellow-400">⏳ Found</span>}</td>
                  <td className="p-2 text-center">{new Date(a.ts).toLocaleTimeString()}</td>
                </tr>
              ))}
              {arbitrageOpportunities.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-zinc-500">No arbitrage opportunities yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= NEW: STRATEGY PERFORMANCE ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4 mb-8">
        <h2 className="text-sm text-zinc-400 mb-3 flex items-center gap-2">
          <TrendingUp className="text-purple-400" />
          Strategy Performance
        </h2>
        {errStrategyPerformance && <ErrorBox title="bot_strategy_performance error" text={errStrategyPerformance} />}
        {latestStrategyPerformance ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(latestStrategyPerformance).map(([name, perf]) => (
              <div key={name} className="bg-zinc-900 border border-zinc-700 rounded p-3">
                <div className="text-sm font-mono mb-2 capitalize">{name}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-zinc-500">Allocation</div>
                    <div className="font-mono">{(Number(perf.allocation) * 100).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">PnL</div>
                    <div className={`font-mono ${Number(perf.pnl) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      ${Number(perf.pnl).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500">ROI</div>
                    <div className={`font-mono ${Number(perf.roi) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {Number(perf.roi).toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500">Win Rate</div>
                    <div className="font-mono">{Number(perf.win_rate).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">Trades</div>
                    <div className="font-mono">{perf.trades}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">Wins/Losses</div>
                    <div className="font-mono">{perf.wins}/{perf.losses}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-zinc-500">No strategy performance data yet</div>
        )}
      </div>

      {/* ================= CAP CONTROL ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4 mb-8">
        <h2 className="text-sm text-zinc-400 mb-3">Risk Control (cap_per_market)</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs text-zinc-500 font-mono">
            current cap: <span className="text-zinc-200">{bankroll ? Number(bankroll.cap_per_market).toFixed(2) : "--"}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-zinc-200 px-2 py-1 rounded text-xs" onClick={() => setCapInput(250)}>250</button>
            <button className="bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-zinc-200 px-2 py-1 rounded text-xs" onClick={() => setCapInput(500)}>500</button>
          </div>
          <div className="flex items-center gap-2">
            <input type="number" className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm w-32" value={capInput} onChange={(e) => setCapInput(Number(e.target.value))} step={1} min={0} />
            <button onClick={writeCapPerMarket} className="bg-emerald-900 hover:bg-emerald-800 text-emerald-200 px-3 py-1 rounded text-xs">Set cap_per_market</button>
          </div>
        </div>
        <div className="text-[11px] text-zinc-500 mt-2">
          This inserts a new <span className="font-mono">bot_bankroll</span> row with the chosen cap. Stop the bot before changing.
        </div>
        {capMsg && <div className="mt-2 text-[11px] font-mono text-zinc-300">{capMsg}</div>}
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
                  <td className={`p-2 text-center ${Number(s.pnl) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {Number(s.pnl).toFixed(2)}
                  </td>
                  <td className="p-2 text-center">{s.settlement_method}</td>
                  <td className="p-2 text-center">{new Date(s.settled_at).toLocaleTimeString()}</td>
                </tr>
              ))}
              {settlements.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-zinc-500">No markets settled yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= RAW TICKS (UPDATED WITH SPREAD) ================= */}
      <div className="bg-black border border-zinc-800 rounded p-4">
        <h2 className="text-xs text-zinc-500 mb-2">Raw Tick Telemetry</h2>
        {errTicks && <ErrorBox title="bot_ticks error" text={errTicks} />}
        <table className="w-full text-xs font-mono">
          <thead className="bg-zinc-900">
            <tr>
              <th className="p-2 text-left">time</th>
              <th className="p-2 text-left">market</th>
              <th className="p-2">edge</th>
              <th className="p-2">spread</th>
              <th className="p-2">EV</th>
              <th className="p-2">profitable</th>
              <th className="p-2">size</th>
            </tr>
          </thead>
          <tbody>
            {ticks.map((t, i) => (
              <tr key={i} className="border-t border-zinc-800">
                <td className="p-2">{new Date(t.created_at).toLocaleTimeString()}</td>
                <td className="p-2 truncate max-w-[320px]">{t.slug}</td>
                <td className="p-2 text-center">{Number(t.edge_after_fees).toFixed(4)}</td>
                <td className="p-2 text-center">{t.spread_percent ? `${Number(t.spread_percent).toFixed(2)}%` : "--"}</td>
                <td className="p-2 text-center">{t.expected_value ? Number(t.expected_value).toFixed(4) : "--"}</td>
                <td className="p-2 text-center">{t.is_profitable !== null ? (t.is_profitable ? "✅" : "❌") : "--"}</td>
                <td className="p-2 text-center">{Number(t.recommended_size).toFixed(2)}</td>
              </tr>
            ))}
            {ticks.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-zinc-500">No tick rows returned yet</td>
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
                  <td className={`p-2 text-center ${Number(v.unrealized_pnl) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {Number(v.unrealized_pnl).toFixed(4)}
                  </td>
                  <td className="p-2 text-center">{v.pricing_quality}</td>
                </tr>
              ))}
              {valuations.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-zinc-500">No valuation rows yet</td>
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
        {errLifetime && <ErrorBox title="lifetime error" text={errLifetime} />}
        <div className="text-xs font-mono text-zinc-400">Selected run_id: {runId ?? "--"}</div>
        <div className="text-xs font-mono text-zinc-400">Latest bankroll row ts: {bankroll?.ts ?? "--"}</div>
        <div className="text-xs font-mono text-zinc-400">
          Lifetime baseline bankroll: {Number.isFinite(Number(lifetimeStartBankroll)) ? Number(lifetimeStartBankroll).toFixed(2) : "--"}
        </div>
        <div className="text-xs font-mono text-zinc-400">
          Lifetime realized pnl (sum all settlements): {Number(lifetimeRealizedPnl).toFixed(2)}
        </div>
      </div>
    </div>
  );
};

/* ========================= SMALL COMPONENTS ========================= */
const Metric = ({ label, value, size }: any) => {
  const isSmall = String(size || "").toLowerCase() === "sm";
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
      <div className="text-[10px] uppercase text-zinc-500">{label}</div>
      <div className={`${isSmall ? "text-base" : "text-lg"} font-mono text-white`}>{value ?? "--"}</div>
    </div>
  );
};

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
