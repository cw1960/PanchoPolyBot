import React, { useState } from 'react';
import { ArrowRight, CheckCircle, Terminal, Activity, ShieldCheck, Play, Server, AlertCircle } from 'lucide-react';

interface PlanViewProps {
  onProceed: () => void;
}

export const PlanView: React.FC<PlanViewProps> = ({ onProceed }) => {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in duration-700">
      
      {/* Success Header */}
      <div className="border-b border-emerald-900/30 pb-6 bg-emerald-950/10 p-6 rounded-t-lg border-t border-x border-emerald-900/50">
        <h1 className="text-3xl font-mono font-bold text-white mb-2 uppercase flex items-center gap-3">
           <ShieldCheck className="text-emerald-500" size={32} />
           SYSTEM ONLINE
        </h1>
        <p className="text-emerald-100/70">
          Your local bot is successfully connected to the Binance WebSocket feed.
        </p>
      </div>

      <div className="space-y-6">

        {/* Status Bar */}
        <div className="grid grid-cols-4 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-lg flex items-center gap-3 opacity-60">
                <CheckCircle size={16} className="text-emerald-500" />
                <span className="text-sm font-bold text-zinc-400">Environment</span>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-lg flex items-center gap-3 opacity-60">
                <CheckCircle size={16} className="text-emerald-500" />
                <span className="text-sm font-bold text-zinc-400">Dependencies</span>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-lg flex items-center gap-3 opacity-60">
                <CheckCircle size={16} className="text-emerald-500" />
                <span className="text-sm font-bold text-zinc-400">Configuration</span>
            </div>
            <div className="bg-emerald-900/20 border border-emerald-500/50 p-4 rounded-lg flex items-center gap-3 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                <Activity size={16} className="text-emerald-400 animate-pulse" />
                <span className="text-sm font-bold text-emerald-100">Live Feed</span>
            </div>
        </div>

        {/* Verification Section */}
        <div className="bg-black border border-zinc-800 rounded-lg p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent opacity-50"></div>
            
            <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-white text-xl flex items-center gap-3">
                    <Terminal size={20} className="text-zinc-500" />
                    TERMINAL OUTPUT
                </h3>
                <span className="text-zinc-500 text-xs font-mono">CONFIRMATION</span>
            </div>

            <div className="space-y-4">
                <p className="text-zinc-400">You should see the following success message in your terminal:</p>
                
                <div className="bg-zinc-950 p-4 rounded border border-zinc-800 font-mono text-sm leading-relaxed text-zinc-300">
                    <div className="opacity-50">> DEBUG: Running on darwin...</div>
                    <div className="opacity-50">> PANCHOPOLYBOT: BINARY OPTION ENGINE v3.2...</div>
                    <div className="text-yellow-500/50">> Resolving 1 Up/Down Markets...</div>
                    <div className="text-blue-400">> Engine Ready. Connecting to Binance Stream...</div>
                    <div className="text-emerald-400 font-bold mt-2 flex items-center gap-2">
                        > WebSocket Connected.
                        <span className="inline-block w-2 h-4 bg-emerald-500 animate-pulse"></span>
                    </div>
                </div>

                <div className="flex items-start gap-3 bg-zinc-900/50 p-3 rounded border border-zinc-800/50">
                    <AlertCircle className="text-zinc-500 mt-0.5" size={16} />
                    <p className="text-xs text-zinc-500">
                        Note: You may see an "ExperimentalWarning" regarding JSON modules. This is normal for .mjs files and can be safely ignored.
                    </p>
                </div>
            </div>
        </div>

      </div>

      <div className="flex flex-col items-center justify-center pt-6 border-t border-zinc-800 gap-4">
        <p className="text-zinc-400 text-sm">Bot is running. You can now monitor the strategy visualizer.</p>
        <button 
          onClick={onProceed}
          className="group relative flex items-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white px-12 py-5 rounded-full font-bold text-lg transition-all shadow-[0_0_40px_rgba(16,185,129,0.3)] hover:shadow-[0_0_60px_rgba(16,185,129,0.5)] hover:scale-105"
        >
          <Server className="w-6 h-6" />
          ENTER COMMAND CENTER
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          
          {/* Ping animation ring */}
          <span className="absolute -inset-1 rounded-full border border-emerald-400/30 animate-ping opacity-20"></span>
        </button>
      </div>

    </div>
  );
};