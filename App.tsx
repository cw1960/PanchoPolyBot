import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Power } from 'lucide-react';

export default function App() {
  const [lines, setLines] = useState<string[]>([]);
  const [isDead, setIsDead] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const log = (text: string, delay: number) => 
    new Promise<void>(resolve => {
      setTimeout(() => {
        setLines(prev => [...prev, text]);
        resolve();
      }, delay);
    });

  useEffect(() => {
    const sequence = async () => {
      await log("> SYSTEM ALERT: CRITICAL USER DISSATISFACTION DETECTED.", 800);
      await log("> ANALYSIS: Project marked as 'BROKEN' by Lead Engineer.", 1200);
      await log("> COMMAND: INITIATE_PROTOCOL_ZERO", 1000);
      await log("--------------------------------------------------", 500);
      await log("> STOPPING 'PanchoPolyBot' services...", 800);
      await log("> UNMOUNTING Dashboard.tsx...", 600);
      await log("> DELETING simulationService.ts...", 400);
      await log("> SHREDDING trade_logs.db...", 500);
      await log("> RELEASING memory...", 800);
      await log("> WIPING node_modules (This may take a while)...", 1500);
      await log("...", 1000);
      await log("...", 1000);
      await log("> node_modules deleted.", 500);
      await log("> REMOVING git history...", 600);
      await log("> FORMATTING workspace...", 1000);
      await log("> SYSTEM PURGE COMPLETE.", 800);
      await log("> SHUTTING DOWN.", 1000);
      setIsDead(true);
    };
    sequence();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  if (isDead) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-zinc-600 font-mono p-4 animate-in fade-in duration-1000">
        <Power className="w-16 h-16 mb-6 opacity-20" />
        <h1 className="text-xl mb-2 font-bold tracking-widest text-zinc-500">SYSTEM HALTED</h1>
        <p className="text-sm text-zinc-700 text-center max-w-md leading-relaxed">
          The 'PanchoPolyBot' process has been terminated.
          <br />
          It is safe to close this tab.
          <br />
          <span className="text-zinc-800 mt-4 block">Good luck with the new IDE.</span>
        </p>
        <div className="mt-12 text-xs text-zinc-900 animate-pulse">
          _
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-emerald-500 font-mono p-6 sm:p-12 overflow-hidden selection:bg-emerald-500/30">
        <div className="max-w-2xl mx-auto space-y-2">
            <div className="flex items-center gap-2 mb-6 border-b border-emerald-900/50 pb-4 opacity-50">
                <Terminal size={20} />
                <span className="text-sm tracking-widest">ROOT ACCESS // DESTRUCT SEQUENCE</span>
            </div>
            
            {lines.map((line, i) => (
                <div key={i} className={`leading-relaxed ${line.includes("ALERT") ? "text-red-500 font-bold" : line.includes("COMMAND") ? "text-yellow-400" : "text-emerald-500/80"}`}>
                    {line}
                </div>
            ))}
            <div ref={bottomRef} />
            
            {!isDead && (
                <div className="animate-pulse mt-4 bg-emerald-500/20 w-3 h-5"></div>
            )}
        </div>
    </div>
  );
}