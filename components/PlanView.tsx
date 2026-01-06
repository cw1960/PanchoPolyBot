import React from 'react';
import { ArrowRight, CheckCircle2, Crosshair, Terminal, FileText, Play, Server, Shield, RefreshCw } from 'lucide-react';

interface PlanViewProps {
  onProceed: () => void;
}

export const PlanView: React.FC<PlanViewProps> = ({ onProceed }) => {
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8 animate-in fade-in duration-700">
      
      {/* Header */}
      <div className="border-b border-zinc-800 pb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-mono font-bold text-emerald-400 mb-2">
            > PROJECT: PANCHOPOLYBOT
          </h1>
          <p className="text-zinc-400">
            Target: Intraday "Up/Down" Binary Options (The 0x8dxd Strategy)
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono bg-zinc-900 px-3 py-1 rounded border border-zinc-800 text-emerald-500">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"/>
          CONNECTED: 45.76.218.147
        </div>
      </div>

      {/* DEPLOYMENT SEQUENCE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left Col: Instructions */}
        <div className="space-y-6">
            <h3 className="text-zinc-300 font-bold flex items-center gap-2 text-lg">
               <Terminal size={18} /> PATCH SEQUENCE
            </h3>
            
            <div className="bg-emerald-950/20 border border-emerald-900/50 p-4 rounded-lg">
               <p className="text-emerald-400 text-sm font-bold mb-2 flex items-center gap-2">
                 <CheckCircle2 size={16}/> BUG IDENTIFIED
               </p>
               <p className="text-zinc-400 text-xs mb-0">
                 The logs showed the API was returning token IDs as strings (<code>"[\"0x...\"]"</code>), causing the bot to read a quote character <code>"</code> instead of the ID. 
                 I have written a patch to parse this correctly.
               </p>
            </div>

            {/* Step 1: Update Code */}
            <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-lg group hover:border-zinc-700 transition-colors">
               <div className="flex items-center justify-between mb-2">
                 <strong className="text-white flex items-center gap-2">1. APPLY PATCH</strong>
                 <span className="text-[10px] text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded">NANO EDITOR</span>
               </div>
               <p className="text-zinc-500 text-xs mb-3">
                 We need to overwrite <code>bot.js</code> with the fixed version. 
               </p>
               <div className="bg-black p-3 rounded text-blue-400 font-mono text-xs border border-zinc-800 select-all cursor-text">
                 nano pancho-bot/backend/bot.js
               </div>
               <p className="text-zinc-600 text-[10px] mt-2 italic">
                 (Delete old code -> Paste New Code -> Ctrl+X -> Y -> Enter)
               </p>
               <p className="text-red-400 text-[10px] mt-1 font-bold">
                 *Or just copy-paste the file content from the AI response directly into the server via SFTP if you prefer.*
               </p>
            </div>

            {/* Step 2: Restart */}
            <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-lg group hover:border-emerald-500/50 transition-colors relative overflow-hidden">
               <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-bl-full pointer-events-none"/>
               <div className="flex items-center justify-between mb-2">
                 <strong className="text-white flex items-center gap-2">2. RESTART ENGINE</strong>
                 <span className="text-[10px] text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded">PM2 PROCESS</span>
               </div>
               <p className="text-zinc-500 text-xs mb-3">Apply the new code.</p>
               <div className="bg-black p-3 rounded text-yellow-400 font-mono text-xs border border-zinc-800 select-all cursor-text break-all">
                 cd pancho-bot && pm2 restart pancho && pm2 logs
               </div>
            </div>
        </div>

        {/* Right Col: Code Preview */}
        <div className="space-y-6">
            <div className="bg-zinc-900/50 border border-zinc-700 p-5 rounded-lg h-full flex flex-col">
              <h3 className="text-zinc-300 font-bold flex items-center gap-2 mb-4">
                 <RefreshCw size={16} /> THE FIX
              </h3>
              <div className="flex-1 bg-black rounded p-4 font-mono text-[10px] text-zinc-400 leading-relaxed overflow-auto border border-zinc-800">
                <span className="text-zinc-600">// OLD BROKEN CODE</span><br/>
                let tokenIds = market.clobTokenIds;<br/>
                <br/>
                <span className="text-emerald-500">// NEW PATCHED CODE</span><br/>
                let tokenIds = market.clobTokenIds;<br/>
                <span className="text-emerald-400">if (typeof tokenIds === 'string') {'{'}</span><br/>
                <span className="text-emerald-400">    tokenIds = JSON.parse(tokenIds);</span><br/>
                <span className="text-emerald-400">{'}'}</span>
              </div>
            </div>
        </div>
      </div>

      {/* Action */}
      <div className="flex justify-end pt-4 border-t border-zinc-800">
        <button 
          onClick={onProceed}
          className="group flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-4 rounded-md font-bold transition-all shadow-lg shadow-emerald-900/20"
        >
          <Crosshair className="w-5 h-5" />
          I HAVE PATCHED THE BOT
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

    </div>
  );
};