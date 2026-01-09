
import React, { useState, useEffect, useRef, useReducer } from 'react';
import { 
  Play, Pause, Square, Save, Activity, Shield, 
  Clock, AlertTriangle, CheckCircle, XCircle, 
  ClipboardList, Terminal, ChevronRight, BarChart3,
  Microscope, FastForward, History
} from 'lucide-react';

// --- TYPES & DATA CONTRACT ---

type Decision = "EXECUTE" | "SKIP";

interface BotEvent {
  id: string;
  timestamp: number;
  market_id: string;
  observed_direction: "UP" | "DOWN";
  confidence: number;
  delta: number;
  decision: Decision;
  skip_reason?: string;
  trade_size: number;
  exposure_before: number;
  exposure_after: number;
  cooldown_applied_ms: number;
  // Proxy Outcomes (Simulated)
  proxy_1m: number;
  proxy_5m: number;
  proxy_correct: boolean | null;
}

interface TestConfig {
  name: string;
  market: string;
  timeframe: string;
  strategyTag: string;
  hypothesis: string;
}

interface Reflections {
  strategy_q1: string; // High confidence performance?
  strategy_q2: string; // Edge decay?
  strategy_q3: string; // Directional bias?
  strategy_q4: string; // Proposed changes?
  system_q1: string;   // Cooldown effectiveness?
  system_q2: string;   // Exposure logic?
  system_q3: string;   // Duplicates?
  system_q4: string;   // Unexpected behavior?
}

interface TestSession {
  id: string;
  config: TestConfig;
  startTime: number;
  endTime: number | null;
  status: "IDLE" | "ACTIVE" | "PAUSED" | "ENDED" | "ARCHIVED";
  events: BotEvent[];
  reflections: Reflections;
  stats: {
    executed: number;
    skipped: number;
    exposureMax: number;
    accuracy: number;
  }
}

// --- MOCK GENERATOR ---

const generateMockEvent = (
  marketId: string, 
  currentExposure: number, 
  lastEventTime: number
): BotEvent => {
  const now = Date.now();
  const timeDiff = now - lastEventTime;
  
  // Simulation Params
  const isCooldown = timeDiff < 3000; // 3s cooldown logic
  const confidence = Math.random();
  const delta = Math.random() * 15;
  const direction = Math.random() > 0.5 ? "UP" : "DOWN";
  const tradeSize = 5;
  const maxExposure = 50;

  let decision: Decision = "SKIP";
  let skip_reason = undefined;

  // Logic Tree
  if (isCooldown) {
    skip_reason = "COOLDOWN_ACTIVE";
  } else if (currentExposure + tradeSize > maxExposure) {
    skip_reason = "MAX_EXPOSURE_LIMIT";
  } else if (confidence < 0.6) {
    skip_reason = "LOW_CONFIDENCE";
  } else {
    decision = "EXECUTE";
  }

  return {
    id: Math.random().toString(36).substr(2, 9),
    timestamp: now,
    market_id: marketId,
    observed_direction: direction,
    confidence: parseFloat(confidence.toFixed(2)),
    delta: parseFloat(delta.toFixed(2)),
    decision,
    skip_reason,
    trade_size: decision === "EXECUTE" ? tradeSize : 0,
    exposure_before: currentExposure,
    exposure_after: decision === "EXECUTE" ? currentExposure + tradeSize : currentExposure,
    cooldown_applied_ms: decision === "EXECUTE" ? 5000 : 0,
    // Proxies
    proxy_1m: parseFloat(((Math.random() - 0.5) * 2).toFixed(2)),
    proxy_5m: parseFloat(((Math.random() - 0.5) * 5).toFixed(2)),
    proxy_correct: decision === "EXECUTE" ? Math.random() > 0.4 : null // 60% win rate sim
  };
};

// --- COMPONENTS ---

export const Dashboard: React.FC = () => {
  // Global State
  const [session, setSession] = useState<TestSession>({
    id: 'init',
    config: { name: '', market: 'BTC-JAN-26', timeframe: '15m', strategyTag: 'v1-momentum', hypothesis: '' },
    startTime: 0,
    endTime: null,
    status: 'IDLE',
    events: [],
    reflections: {
      strategy_q1: '', strategy_q2: '', strategy_q3: '', strategy_q4: '',
      system_q1: '', system_q2: '', system_q3: '', system_q4: ''
    },
    stats: { executed: 0, skipped: 0, exposureMax: 0, accuracy: 0 }
  });

  const [lastEventTime, setLastEventTime] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load saved count on mount
  useEffect(() => {
    const history = JSON.parse(localStorage.getItem('polymarket_lab_sessions') || '[]');
    setSavedCount(history.length);
  }, []);

  // --- CONTROLLER LOGIC ---

  useEffect(() => {
    let interval: any;
    if (session.status === 'ACTIVE') {
      interval = setInterval(() => {
        // 1. Determine current exposure from last event
        const currentExp = session.events.length > 0 
          ? session.events[session.events.length - 1].exposure_after 
          : 0;

        // 2. Generate Event
        const newEvent = generateMockEvent(session.config.market, currentExp, lastEventTime);
        
        // 3. Update State
        setSession(prev => ({
          ...prev,
          events: [...prev.events, newEvent]
        }));
        
        if (newEvent.decision === "EXECUTE") {
          setLastEventTime(newEvent.timestamp);
        }

        // Auto-scroll
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }

      }, 2000); // 2 second tick
    }
    return () => clearInterval(interval);
  }, [session.status, lastEventTime, session.events]);

  const handleStart = () => {
    if (!session.config.name || !session.config.hypothesis) {
      alert("Please fill in Test Name and Hypothesis to begin research session.");
      return;
    }
    setSession(prev => ({ ...prev, status: 'ACTIVE', startTime: Date.now(), events: [] }));
  };

  const handleStop = () => {
    const executed = session.events.filter(e => e.decision === "EXECUTE");
    const wins = executed.filter(e => e.proxy_correct).length;
    
    setSession(prev => ({ 
      ...prev, 
      status: 'ENDED', 
      endTime: Date.now(),
      stats: {
        executed: executed.length,
        skipped: prev.events.length - executed.length,
        exposureMax: Math.max(...prev.events.map(e => e.exposure_after), 0),
        accuracy: executed.length > 0 ? (wins / executed.length) * 100 : 0
      }
    }));
  };

  const handleSave = () => {
    // 1. Create Record
    const record = {
      ...session,
      status: 'ARCHIVED',
      savedAt: Date.now()
    };
    
    // 2. Save to LocalStorage
    try {
      const history = JSON.parse(localStorage.getItem('polymarket_lab_sessions') || '[]');
      history.push(record);
      localStorage.setItem('polymarket_lab_sessions', JSON.stringify(history));
      setSavedCount(history.length);
      
      console.log("Session saved to LocalStorage:", record);
      
      // 3. Clean Reset
      setSession({
        id: Math.random().toString(36).substr(2, 9),
        config: { ...session.config, name: '', hypothesis: '' }, // Reset name/hypothesis, keep settings
        startTime: 0,
        endTime: null,
        status: 'IDLE',
        events: [],
        reflections: {
          strategy_q1: '', strategy_q2: '', strategy_q3: '', strategy_q4: '',
          system_q1: '', system_q2: '', system_q3: '', system_q4: ''
        },
        stats: { executed: 0, skipped: 0, exposureMax: 0, accuracy: 0 }
      });
      
      alert(`Session archived successfully. Total saved sessions: ${history.length}`);
    } catch (e) {
      alert("Failed to save to LocalStorage (Quota exceeded?)");
      console.error(e);
    }
  };

  // --- RENDER ---

  const currentExposure = session.events.length > 0 ? session.events[session.events.length - 1].exposure_after : 0;
  const cooldownRemaining = Math.max(0, 5000 - (Date.now() - lastEventTime));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans p-6 selection:bg-emerald-900 selection:text-white">
      
      {/* HEADER */}
      <div className="mb-8 border-b border-zinc-800 pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-mono font-bold text-white flex items-center gap-3">
            <Microscope className="text-emerald-500" />
            POLYMARKET RESEARCH LAB <span className="text-zinc-600 text-sm px-2 py-0.5 border border-zinc-800 rounded">v1.0.0-BETA</span>
          </h1>
          <p className="text-zinc-500 text-sm mt-1 font-mono">
            Scientific Trading Experiment Environment • No Real Money Execution
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono text-zinc-500">
             <History size={14} /> SAVED SESSIONS: {savedCount}
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono">
            <Shield size={14} className="text-emerald-500" /> DRY_RUN: ENABLED
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono">
             EXECUTION: {session.status === 'ACTIVE' ? <span className="text-emerald-500 animate-pulse">LIVE</span> : <span className="text-zinc-500">OFFLINE</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 h-[calc(100vh-140px)]">

        {/* 1. LEFT PANEL: CONTROLLER & STATE */}
        <div className="col-span-3 space-y-6 flex flex-col">
          
          {/* Test Window Controller */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 flex-none">
            <div className="flex items-center gap-2 mb-4 text-emerald-400 font-bold font-mono text-sm uppercase">
              <Terminal size={16} /> Experiment Setup
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase text-zinc-500 font-bold">Experiment Name</label>
                <input 
                  disabled={session.status !== 'IDLE'}
                  value={session.config.name}
                  onChange={e => setSession(prev => ({...prev, config: {...prev.config, name: e.target.value}}))}
                  className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none disabled:opacity-50"
                  placeholder="e.g. Momentum-V3-BTC"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase text-zinc-500 font-bold">Market</label>
                  <select 
                    disabled={session.status !== 'IDLE'}
                    className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-white outline-none disabled:opacity-50"
                    value={session.config.market}
                    onChange={e => setSession(prev => ({...prev, config: {...prev.config, market: e.target.value}}))}
                  >
                    <option>BTC-JAN-26</option>
                    <option>ETH-DEC-31</option>
                    <option>SOL-FUTURES</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-zinc-500 font-bold">Timeframe</label>
                  <select 
                    disabled={session.status !== 'IDLE'}
                    className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-white outline-none disabled:opacity-50"
                  >
                    <option>1m</option>
                    <option>5m</option>
                    <option>15m</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase text-zinc-500 font-bold">Hypothesis</label>
                <textarea 
                  disabled={session.status !== 'IDLE'}
                  value={session.config.hypothesis}
                  onChange={e => setSession(prev => ({...prev, config: {...prev.config, hypothesis: e.target.value}}))}
                  className="w-full bg-black border border-zinc-700 rounded p-2 text-sm text-white h-20 resize-none focus:border-emerald-500 outline-none disabled:opacity-50"
                  placeholder="I expect high-confidence signals (>80%) to have a 65% win rate in 5m window..."
                />
              </div>

              {/* CONTROLS */}
              <div className="pt-2 grid grid-cols-2 gap-2">
                {session.status === 'IDLE' && (
                  <button onClick={handleStart} className="col-span-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded flex items-center justify-center gap-2 transition-all">
                    <Play size={18} fill="currentColor" /> START TEST
                  </button>
                )}
                
                {session.status === 'ACTIVE' && (
                  <>
                    <button onClick={() => setSession(prev => ({...prev, status: 'PAUSED'}))} className="bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
                      <Pause size={18} fill="currentColor" /> PAUSE
                    </button>
                    <button onClick={handleStop} className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
                      <Square size={18} fill="currentColor" /> END SESSION
                    </button>
                  </>
                )}

                {session.status === 'PAUSED' && (
                  <button onClick={() => setSession(prev => ({...prev, status: 'ACTIVE'}))} className="col-span-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
                    <Play size={18} fill="currentColor" /> RESUME
                  </button>
                )}

                {(session.status === 'ENDED' || session.status === 'ARCHIVED') && (
                  <div className="col-span-2 bg-zinc-800 text-zinc-500 font-bold py-3 rounded flex items-center justify-center gap-2 cursor-not-allowed">
                     SESSION LOCKED
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Live System State */}
          <div className="bg-black border border-zinc-800 rounded-lg p-4 flex-none space-y-4">
             <div className="flex items-center gap-2 text-zinc-400 font-bold font-mono text-sm uppercase border-b border-zinc-900 pb-2">
               <Activity size={16} /> System Vitality
             </div>

             <div className="grid grid-cols-2 gap-4">
               <div>
                 <span className="text-[10px] uppercase text-zinc-600 font-bold block">Current Exposure</span>
                 <span className={`text-xl font-mono font-bold ${currentExposure > 40 ? 'text-red-500' : 'text-white'}`}>
                   ${currentExposure}
                 </span>
                 <span className="text-[10px] text-zinc-600 block">Max: $50.00</span>
               </div>
               <div>
                 <span className="text-[10px] uppercase text-zinc-600 font-bold block">Cooldown</span>
                 <span className={`text-xl font-mono font-bold ${cooldownRemaining > 0 ? 'text-yellow-500' : 'text-emerald-500'}`}>
                   {cooldownRemaining > 0 ? (cooldownRemaining/1000).toFixed(1) + 's' : 'READY'}
                 </span>
               </div>
             </div>

             <div>
               <span className="text-[10px] uppercase text-zinc-600 font-bold block mb-1">Exposure Utilization</span>
               <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden">
                 <div 
                    className={`h-full transition-all duration-500 ${currentExposure > 45 ? 'bg-red-500' : 'bg-emerald-500'}`} 
                    style={{ width: `${(currentExposure / 50) * 100}%` }}
                 ></div>
               </div>
             </div>
          </div>

          {/* Session Stats (Live) */}
          <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-lg p-4 flex-1">
             <div className="flex items-center gap-2 text-zinc-500 font-bold font-mono text-sm uppercase mb-3">
               <BarChart3 size={16} /> Live Metrics
             </div>
             <div className="space-y-2 font-mono text-xs">
               <div className="flex justify-between">
                 <span className="text-zinc-500">Events Processed</span>
                 <span className="text-white">{session.events.length}</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-zinc-500">Executed Trades</span>
                 <span className="text-emerald-400">{session.events.filter(e => e.decision === 'EXECUTE').length}</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-zinc-500">Skipped (Risk/Conf)</span>
                 <span className="text-yellow-500">{session.events.filter(e => e.decision === 'SKIP').length}</span>
               </div>
             </div>
          </div>
        </div>

        {/* 2. CENTER PANEL: DECISION STREAM */}
        <div className="col-span-6 bg-black border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
          <div className="bg-zinc-900/80 p-3 border-b border-zinc-800 flex justify-between items-center backdrop-blur">
            <h2 className="font-mono text-sm font-bold text-white flex items-center gap-2">
              <FastForward size={16} className="text-blue-500" /> DECISION STREAM
            </h2>
            <div className="flex gap-4 text-[10px] font-mono uppercase text-zinc-500">
               <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500/20 border border-emerald-500"></div> Executed</span>
               <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500/20 border border-yellow-500"></div> Skipped</span>
               <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500/20 border border-red-500"></div> Blocked</span>
            </div>
          </div>

          {/* STREAM TABLE */}
          <div className="flex-1 overflow-y-auto p-0" ref={scrollRef}>
             {session.events.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center text-zinc-700 space-y-4">
                 <Activity size={48} className="opacity-20" />
                 <p className="font-mono text-xs">WAITING FOR DATA STREAM...</p>
               </div>
             ) : (
               <table className="w-full text-left border-collapse">
                 <thead className="bg-zinc-900/50 sticky top-0 z-10 backdrop-blur-sm">
                   <tr>
                     <th className="p-2 text-[10px] uppercase text-zinc-500 font-mono">Time</th>
                     <th className="p-2 text-[10px] uppercase text-zinc-500 font-mono">Dir</th>
                     <th className="p-2 text-[10px] uppercase text-zinc-500 font-mono">Conf</th>
                     <th className="p-2 text-[10px] uppercase text-zinc-500 font-mono">Delta</th>
                     <th className="p-2 text-[10px] uppercase text-zinc-500 font-mono">Decision</th>
                     <th className="p-2 text-[10px] uppercase text-zinc-500 font-mono">Reason</th>
                     <th className="p-2 text-[10px] uppercase text-zinc-500 font-mono">Exp</th>
                   </tr>
                 </thead>
                 <tbody className="font-mono text-xs">
                   {session.events.map((e) => {
                     // Row Styling
                     let bgClass = "bg-transparent hover:bg-zinc-900/30";
                     let textClass = "text-zinc-400";
                     
                     if (e.decision === "EXECUTE") {
                       bgClass = "bg-emerald-950/10 hover:bg-emerald-900/20 border-l-2 border-emerald-500";
                       textClass = "text-emerald-100";
                     } else if (e.skip_reason === "LOW_CONFIDENCE") {
                       bgClass = "bg-yellow-950/5 hover:bg-yellow-900/10 border-l-2 border-yellow-600/30";
                       textClass = "text-yellow-100/70";
                     } else {
                       bgClass = "bg-red-950/5 hover:bg-red-900/10 border-l-2 border-red-900/50";
                       textClass = "text-red-100/60";
                     }

                     return (
                       <tr key={e.id} className={`border-b border-zinc-800/50 transition-colors ${bgClass}`}>
                         <td className="p-2 text-zinc-500">{new Date(e.timestamp).toLocaleTimeString().split(' ')[0]}</td>
                         <td className="p-2 font-bold">{e.observed_direction}</td>
                         <td className="p-2">{(e.confidence * 100).toFixed(0)}%</td>
                         <td className="p-2">${e.delta.toFixed(2)}</td>
                         <td className="p-2 font-bold">{e.decision}</td>
                         <td className="p-2 text-[10px] uppercase tracking-wide opacity-80">{e.skip_reason || '-'}</td>
                         <td className="p-2 text-zinc-500">${e.exposure_after}</td>
                       </tr>
                     );
                   })}
                 </tbody>
               </table>
             )}
          </div>
        </div>

        {/* 3. RIGHT PANEL: SUMMARY & REFLECTION */}
        <div className="col-span-3 space-y-6 flex flex-col h-full overflow-hidden">
          
          {/* Post-Test Summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex-none">
            <div className="flex items-center gap-2 mb-4 text-zinc-300 font-bold font-mono text-sm uppercase">
               <ClipboardList size={16} className="text-purple-500" /> Session Summary
            </div>
            
            {session.status === 'ENDED' || session.status === 'ARCHIVED' ? (
              <div className="space-y-4">
                 <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
                      <div className="text-[10px] text-zinc-500 uppercase">Exec Rate</div>
                      <div className="text-lg font-mono font-bold text-white">
                        {session.stats.executed > 0 ? ((session.stats.executed / session.events.length) * 100).toFixed(1) : 0}%
                      </div>
                    </div>
                    <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
                      <div className="text-[10px] text-zinc-500 uppercase">Sim Accuracy</div>
                      <div className="text-lg font-mono font-bold text-emerald-400">
                        {session.stats.accuracy.toFixed(1)}%
                      </div>
                    </div>
                 </div>
                 
                 <div className="text-xs text-zinc-500 space-y-1 p-2 bg-zinc-950/50 rounded">
                   <div className="flex justify-between">
                     <span>Max Exposure Used:</span>
                     <span className={session.stats.exposureMax > 40 ? "text-red-400" : "text-zinc-300"}>${session.stats.exposureMax}</span>
                   </div>
                   <div className="flex justify-between">
                     <span>Total Skipped:</span>
                     <span>{session.stats.skipped}</span>
                   </div>
                 </div>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-zinc-600 text-xs italic border-2 border-dashed border-zinc-800 rounded">
                Available after session ends
              </div>
            )}
          </div>

          {/* Reflection Form */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex-1 flex flex-col overflow-hidden">
             <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-2">
                <div className="flex items-center gap-2 text-zinc-300 font-bold font-mono text-sm uppercase">
                  <CheckCircle size={16} className="text-blue-500" /> Reflections
                </div>
                {session.status === 'ENDED' && (
                  <button onClick={handleSave} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-3 py-1.5 rounded transition-colors">
                    <Save size={12} /> SAVE REPORT
                  </button>
                )}
             </div>

             <div className="flex-1 overflow-y-auto space-y-6 pr-2">
                {(session.status === 'ENDED' || session.status === 'ARCHIVED') ? (
                  <>
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-emerald-500 uppercase">Strategy Performance</h4>
                      <div>
                        <label className="text-[10px] text-zinc-500 block mb-1">Did high-confidence trades outperform?</label>
                        <textarea 
                          value={session.reflections.strategy_q1}
                          onChange={e => setSession(prev => ({...prev, reflections: {...prev.reflections, strategy_q1: e.target.value}}))}
                          className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-white h-16 resize-none focus:border-blue-500 outline-none" 
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 block mb-1">Observed Edge Decay / Latency?</label>
                        <textarea 
                          value={session.reflections.strategy_q2}
                          onChange={e => setSession(prev => ({...prev, reflections: {...prev.reflections, strategy_q2: e.target.value}}))}
                          className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-white h-16 resize-none focus:border-blue-500 outline-none" 
                        />
                      </div>
                    </div>

                    <div className="space-y-3 pt-4 border-t border-zinc-800">
                      <h4 className="text-xs font-bold text-blue-500 uppercase">System Integrity</h4>
                      <div>
                        <label className="text-[10px] text-zinc-500 block mb-1">Cooldown Effectiveness?</label>
                        <textarea 
                          value={session.reflections.system_q1}
                          onChange={e => setSession(prev => ({...prev, reflections: {...prev.reflections, system_q1: e.target.value}}))}
                          className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-white h-16 resize-none focus:border-blue-500 outline-none" 
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 block mb-1">Exposure Logic Issues?</label>
                        <textarea 
                          value={session.reflections.system_q2}
                          onChange={e => setSession(prev => ({...prev, reflections: {...prev.reflections, system_q2: e.target.value}}))}
                          className="w-full bg-black border border-zinc-800 rounded p-2 text-xs text-white h-16 resize-none focus:border-blue-500 outline-none" 
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-700 space-y-2 opacity-50">
                    <ClipboardList size={32} />
                    <p className="text-xs text-center px-4">Complete the active session to unlock the reflection journal.</p>
                  </div>
                )}
             </div>
          </div>

        </div>
      </div>
    </div>
  );
};
