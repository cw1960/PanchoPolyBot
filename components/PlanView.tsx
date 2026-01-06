import React from 'react';
import { ArrowRight, Cpu, ShieldAlert, Zap, Layers, CheckCircle2, Search } from 'lucide-react';

interface PlanViewProps {
  onProceed: () => void;
}

export const PlanView: React.FC<PlanViewProps> = ({ onProceed }) => {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in duration-700">
      
      {/* Header */}
      <div className="border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-mono font-bold text-emerald-400 mb-2">
          > PROJECT: PANCHOPOLYBOT
        </h1>
        <p className="text-zinc-400">
          Automated Market Discovery & Latency Arbitrage // Target: Polymarket
        </p>
      </div>

      {/* Capability Statement */}
      <div className="bg-zinc-900/50 border border-zinc-700 p-6 rounded-lg">
        <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
          <CheckCircle2 className="text-emerald-500" />
          System Upgrade: Auto-Discovery
        </h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          I have updated the architecture to address your concern. <strong>You do not need to manually find Token IDs.</strong> 
          The bot now includes a <span className="text-emerald-400">Market Resolution Engine</span>. You simply provide a keyword or URL slug (e.g., "bitcoin"), and the bot queries the Gamma API to map them to the executable Order Book IDs automatically.
        </p>
        <div className="bg-blue-900/20 border-l-4 border-blue-500 p-4 text-sm text-blue-200">
          <strong>NEW WORKFLOW:</strong> Input "Slug" (URL text) -> Bot fetches IDs -> Bot subscribes to Binance WebSocket -> Execution loop begins.
        </div>
      </div>

      {/* The Plan */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Core Strategy */}
        <div className="space-y-4">
          <h3 className="text-lg font-mono font-bold text-blue-400 flex items-center gap-2">
            <Zap size={18} /> STRATEGY LOGIC
          </h3>
          <ul className="space-y-3 text-sm text-zinc-400">
            <li className="flex gap-3">
              <span className="text-zinc-600">01.</span>
              <span>
                <strong>Discovery:</strong> Bot queries <code>gamma-api.polymarket.com</code> to resolve human-readable slugs into executable <code>token_id</code>s.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-600">02.</span>
              <span>
                <strong>Ingest Data:</strong> Connect to Binance Global WebSocket for "Leading" price signal.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-600">03.</span>
              <span>
                <strong>Calculate Delta:</strong> If Spot moves > 0.5% while Poly is stagnant, a latency gap exists.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-600">04.</span>
              <span>
                <strong>Execute:</strong> Fire FOK orders immediately on the resolved IDs.
              </span>
            </li>
          </ul>
        </div>

        {/* Tech Stack */}
        <div className="space-y-4">
          <h3 className="text-lg font-mono font-bold text-purple-400 flex items-center gap-2">
            <Layers size={18} /> TECH ARCHITECTURE
          </h3>
          <ul className="space-y-3 text-sm text-zinc-400">
            <li className="flex gap-3">
              <span className="text-zinc-600">FE.</span>
              <span>
                <strong>Dashboard:</strong> Visualizes the scanner finding markets and the resulting spread.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-600">BE.</span>
              <span>
                <strong>Node.js + Axios:</strong> Fetches market metadata dynamically on startup.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-600">L2.</span>
              <span>
                <strong>Polygon PoS:</strong> Direct smart contract interaction via CLOB API.
              </span>
            </li>
          </ul>
        </div>

      </div>

      {/* Action */}
      <div className="flex justify-end pt-4">
        <button 
          onClick={onProceed}
          className="group flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-md font-bold transition-all"
        >
          <Cpu className="w-5 h-5" />
          LAUNCH COMMAND CENTER
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

    </div>
  );
};