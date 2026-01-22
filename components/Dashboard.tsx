import React, { useState, useEffect, useRef } from 'react';
import { Shield } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface Tick {
  slug: string;
  yes_price: number;
  no_price: number;
  pair_cost: number;
  edge_after_fees: number;
  kelly_fraction: number;
  recommended_size: number;
  signal: string;
  created_at: string;
}

interface BankrollRow {
  bankroll: number;
  cap_per_market: number;
  exposure: number;
  created_at: string;
}

interface ResolvedMarket {
  settled_at: string;
  slug: string;
  final_outcome: string;
  pnl: number;
  settlement_method: string;
  resolved_at?: string | null;
  evidence?: any;
}

interface PnlSummaryRow {
  total_trades: number;
  wins: number;
  realized_pnl: number;
}

function safeNum(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmtLatencySeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m <= 0) return `${rem}s`;
  return `${m}m ${rem}s`;
}

function computeLatencySeconds(settledAt?: string | null, resolvedAt?: string | null): number | null {
  if (!settledAt || !resolvedAt) return null;
  const a = Date.parse(settledAt);
  const b = Date.parse(resolvedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (a - b) / 1000;
}

function prettyJson(x: any): string {
  try {
    if (x == null) return '';
    if (typeof x === 'string') {
      // If it's JSON string, pretty-print; otherwise return as-is.
      try {
        const parsed = JSON.parse(x);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return x;
      }
    }
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x ?? '');
  }
}

export const Dashboard: React.FC = () => {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [bankroll, setBankroll] = useState<BankrollRow | null>(null);
  const [resolved, setResolved] = useState<ResolvedMarket[]>([]);
  const [pnlSummary, setPnlSummary] = useState<PnlSummaryRow | null>(null);

  const [ticksConnected, setTicksConnected] = useState(false);
  const [bankrollConnected, setBankrollConnected] = useState(false);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const [alertSound, setAlertSound] = useState(true);
  const [alertHighlight, setAlertHighlight] = useState(true);

  const lastTopSettledAtRef = useRef<string | null>(null);
  const flashKeyRef = useRef<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);

  /* -------------------- TICKS (POLLING) -------------------- */
  useEffect(() => {
    loadTicks();
    const i = setInterval(loadTicks, 2000);
    return () => clearInterval(i);
  }, []);

  async function loadTicks() {
    try {
      const { data, error } = await supabase
        .from('bot_ticks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('ticks error', error);
        setTicksConnected(false);
        return;
      }

      setTicks(data || []);
      setTicksConnected(true);
    } catch (err) {
      console.error('ticks load failed', err);
      setTicksConnected(false);
    }
  }

  /* -------------------- BANKROLL (REALTIME) -------------------- */
  useEffect(() => {
    let channel: any;

    async function initBankroll() {
      const { data, error } = await supabase
        .from('bot_bankroll_current')
        .select('*')
        .single();

      if (!error && data) {
        setBankroll(data);
        setBankrollConnected(true);
      } else {
        console.error('bankroll load error', error);
        setBankrollConnected(false);
      }

      channel = supabase
        .channel('bankroll-current')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'bot_bankroll_current'
          },
          (payload) => {
            if (payload.new) {
              setBankroll(payload.new as BankrollRow);
              setBankrollConnected(true);
            }
          }
        )
        .subscribe();
    }

    initBankroll();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  /* -------------------- RESOLVED MARKETS (POLLING) -------------------- */
  useEffect(() => {
    loadResolved();
    const i = setInterval(loadResolved, 5000);
    return () => clearInterval(i);
  }, []);

  async function loadResolved() {
    const { data, error } = await supabase
      .from('bot_resolved_markets_recent')
      .select('*')
      .limit(50);

    if (error) {
      console.error('resolved markets load error', error);
      return;
    }

    const rows = (data || []) as ResolvedMarket[];

    // Detect "new resolution" by comparing the newest settled_at.
    const top = rows.length > 0 ? rows[0] : null;
    const topSettledAt = top?.settled_at ?? null;

    if (topSettledAt && lastTopSettledAtRef.current && topSettledAt !== lastTopSettledAtRef.current) {
      // New market resolved since last poll
      const key = `${top.slug}::${top.settled_at}`;
      if (alertHighlight) {
        flashKeyRef.current = key;
        setFlashKey(key);
        // clear highlight after a short time
        window.setTimeout(() => {
          // only clear if still same flash key
          if (flashKeyRef.current === key) setFlashKey(null);
        }, 2500);
      }

      if (alertSound) {
        try {
          // Simple beep using WebAudio
          const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = 880;
          gain.gain.value = 0.04;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          setTimeout(() => {
            osc.stop();
            ctx.close();
          }, 120);
        } catch {
          // no-op
        }
      }
    }

    lastTopSettledAtRef.current = topSettledAt;
    setResolved(rows);
  }

  /* -------------------- PNL SUMMARY (POLLING) -------------------- */
  useEffect(() => {
    loadPnlSummary();
    const i = setInterval(loadPnlSummary, 5000);
    return () => clearInterval(i);
  }, []);

  async function loadPnlSummary() {
    const { data, error } = await supabase
      .from('bot_pnl_summary')
      .select('*')
      .single();

    if (error) {
      console.error('pnl summary load error', error);
      return;
    }

    if (data) {
      setPnlSummary({
        total_trades: safeNum((data as any).total_trades),
        wins: safeNum((data as any).wins),
        realized_pnl: safeNum((data as any).realized_pnl),
      });
    }
  }

  const connected = ticksConnected && bankrollConnected;
  const latest = ticks.length > 0 ? ticks[0] : null;

  /* ---- UNREALIZED ESTIMATE (DISPLAY ONLY) ----
     This is NOT authoritative. It's derived from tick economics, not settlement.
  */
  const unrealizedEstimate = ticks.reduce((acc, t) => {
    return acc + (1 - t.pair_cost) * t.recommended_size;
  }, 0);

  const realizedPnl = pnlSummary ? pnlSummary.realized_pnl : 0;
  const totalPnl = realizedPnl + unrealizedEstimate;

  const winRate =
    pnlSummary && pnlSummary.total_trades > 0
      ? (pnlSummary.wins / pnlSummary.total_trades) * 100
      : 0;

  const lastPnlEst = latest
    ? (1 - latest.pair_cost) * latest.recommended_size
    : 0;

  const lastEdgePct = latest
    ? (1 - latest.pair_cost) * 100
    : 0;

  function toggleExpanded(key: string) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 p-6">
      <h1 className="text-2xl font-mono text-white flex items-center gap-2 mb-6">
        <Shield className="text-emerald-500" />
        LIVE BOT TELEMETRY
        <span
          className={`ml-4 text-xs px-2 py-1 rounded ${
            connected ? 'bg-emerald-900 text-emerald-200' : 'bg-red-900 text-red-200'
          }`}
        >
          {connected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>

        <span className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-emerald-500"
              checked={alertHighlight}
              onChange={(e) => setAlertHighlight(e.target.checked)}
            />
            highlight
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-emerald-500"
              checked={alertSound}
              onChange={(e) => setAlertSound(e.target.checked)}
            />
            sound
          </label>
        </span>
      </h1>

      {/* BANKROLL */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card label="Bankroll" value={bankroll ? bankroll.bankroll.toFixed(2) : '--'} />
        <Card label="Cap / Market" value={bankroll ? bankroll.cap_per_market.toFixed(2) : '--'} />
        <Card label="Exposure" value={bankroll ? bankroll.exposure.toFixed(2) : '--'} />
      </div>

      {/* PNL SUMMARY */}
      <div className="bg-black border border-zinc-800 p-4 rounded mb-6">
        <h2 className="text-xs text-zinc-500 mb-3 uppercase">PNL SUMMARY</h2>
        <div className="grid grid-cols-4 gap-4 mb-3">
          <Card label="Realized PnL $" value={realizedPnl.toFixed(2)} />
          <Card label="Unrealized est. $" value={unrealizedEstimate.toFixed(2)} />
          <Card label="Total PnL $" value={totalPnl.toFixed(2)} />
          <Card
            label="Win Rate"
            value={
              pnlSummary
                ? `${pnlSummary.wins} / ${pnlSummary.total_trades} (${winRate.toFixed(1)}%)`
                : '--'
            }
          />
        </div>

        {latest && (
          <div className="grid grid-cols-3 gap-4">
            <Card label="Last Trade est. PnL $" value={lastPnlEst.toFixed(2)} />
            <Card label="Last Edge %" value={lastEdgePct.toFixed(3) + '%'} />
            <Card label="Kelly Size $" value={latest.recommended_size.toFixed(2)} />
          </div>
        )}

        <div className="mt-3 text-[11px] text-zinc-500">
          Note: Realized PnL is authoritative (settlements). Unrealized is an estimate derived from ticks.
        </div>
      </div>

      {/* RESOLVED MARKETS */}
      <div className="bg-black border border-zinc-800 rounded mb-6">
        <div className="p-3 text-xs text-zinc-400 uppercase flex items-center justify-between">
          <span>Resolved Markets</span>
          <span className="text-zinc-600">{resolved.length} shown</span>
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-zinc-900 sticky top-0">
              <tr>
                <th className="p-2 text-left">Settled</th>
                <th className="p-2 text-left">Market</th>
                <th className="p-2 text-center">Outcome</th>
                <th className="p-2 text-center">PnL</th>
                <th className="p-2 text-center">Latency</th>
                <th className="p-2 text-center">Method</th>
              </tr>
            </thead>

            <tbody>
              {resolved.map((r, i) => {
                const key = `${r.slug}::${r.settled_at}`;
                const isExpanded = expandedKey === key;
                const isFlashing = flashKey === key;

                const latencySec = computeLatencySeconds(r.settled_at, r.resolved_at ?? null);
                const latencyStr = latencySec == null ? '--' : fmtLatencySeconds(latencySec);

                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`border-t border-zinc-800 cursor-pointer ${
                        isFlashing ? 'bg-emerald-950/40' : ''
                      }`}
                      onClick={() => toggleExpanded(key)}
                      title="Click to expand evidence"
                    >
                      <td className="p-2">
                        {new Date(r.settled_at).toLocaleTimeString()}
                      </td>

                      <td className="p-2 truncate max-w-[300px]">{r.slug}</td>

                      <td className="p-2 text-center">{r.final_outcome}</td>

                      <td className={`p-2 text-center ${r.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {safeNum(r.pnl).toFixed(2)}
                      </td>

                      <td className="p-2 text-center text-zinc-300">{latencyStr}</td>

                      <td className="p-2 text-center text-zinc-300">{r.settlement_method}</td>
                    </tr>

                    {isExpanded && (
                      <tr className="border-t border-zinc-800">
                        <td colSpan={6} className="p-3 bg-zinc-950">
                          <div className="text-[11px] text-zinc-500 mb-2 uppercase">
                            Evidence (click row to collapse)
                          </div>
                          <pre className="text-[11px] leading-snug text-zinc-300 whitespace-pre-wrap break-words">
                            {prettyJson(r.evidence)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {resolved.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-zinc-500">
                    No markets resolved yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* EMPTY STATE */}
      {ticks.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded p-6 text-center text-zinc-500">
          Waiting for telemetry from bot_ticks...
        </div>
      )}

      {/* RAW TICKS */}
      {ticks.length > 0 && (
        <div className="bg-black border border-zinc-800 rounded">
          <table className="w-full text-xs font-mono">
            <thead className="bg-zinc-900">
              <tr>
                <th className="p-2 text-left">time</th>
                <th className="p-2 text-left">market</th>
                <th className="p-2">yes</th>
                <th className="p-2">no</th>
                <th className="p-2">edge</th>
                <th className="p-2">kelly</th>
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
                  <td className="p-2 text-center">{t.yes_price}</td>
                  <td className="p-2 text-center">{t.no_price}</td>
                  <td className="p-2 text-center">{t.edge_after_fees.toFixed(4)}</td>
                  <td className="p-2 text-center">{t.kelly_fraction.toFixed(4)}</td>
                  <td className="p-2 text-center">{t.recommended_size.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const Card = ({ label, value }: any) => (
  <div className="bg-zinc-900 p-3 rounded border border-zinc-800">
    <div className="text-[10px] text-zinc-500 uppercase">{label}</div>
    <div className="text-lg font-mono text-white truncate">{value}</div>
  </div>
);
