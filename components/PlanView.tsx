import React from 'react';
import { ArrowRight, Cpu, ShieldAlert, Zap, Layers, CheckCircle2 } from 'lucide-react';

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
          Latency Arbitrage & Event-Driven Execution System // Target: Polymarket
        </p>
      </div>

      {/* Capability Statement */}
      <div className="bg-zinc-900/50 border border-zinc-700 p-6 rounded-lg">
        <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
          <CheckCircle2 className="text-emerald-500" />
          Feasibility Confirmation
        </h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          Yes, I can design and build the architecture for <strong>PanchoPolyBot</strong>. 
          The strategy described (0x8dxd) relies on <span className="text-emerald-400">Mechanical Arbitrage</span>—exploiting the time delta between spot price updates (Binance/Coinbase) and the repricing of outcome shares on Polymarket's order book (CTF Exchange).
        </p>
        <div className="bg-amber-900/20 border-l-4 border-amber-500 p-4 text-sm text-amber-200">
          <strong>CRITICAL NOTE:</strong> While I will build the <strong>React Command Center</strong> and <strong>Simulation Logic</strong> here, a production-grade High-Frequency Trading (HFT) bot requires a backend (Rust/Go/Node.js) for direct blockchain interaction and millisecond latency. This web app will serve as the <em>Controller</em> and <em>Strategy Visualizer</em> for that backend.
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
                <strong>Ingest Real-Time Data:</strong> Connect to Binance WebSocket (BTC/USDT) for the "Leading" signal.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-600">02.</span>
              <span>
                <strong>Monitor Polymarket:</strong> Poll or Stream Polymarket order book (CTF/Gnosis) for the "Lagging" signal.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-600">03.</span>
              <span>
                <strong>Calculate Delta:</strong> If <code>Spot_Price</code> moves > 0.5% in 2s AND <code>Poly_Price</code> has moved &lt; 0.1%, a latency gap exists.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-600">04.</span>
              <span>
                <strong>Execute:</strong> Fire a market order via Polygon RPC (or Relayer) into the lagging position.
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
                <strong>React + Tailwind + Recharts:</strong> For monitoring spreads, configuring thresholds, and manual overrides.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-600">BE.</span>
              <span>
                <strong>Node.js / Rust:</strong> Ethers.js for blockchain interaction. Web3.js for WebSocket management.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-zinc-600">L2.</span>
              <span>
                <strong>Polygon PoS:</strong> Low gas, high throughput environment where Polymarket resides.
              </span>
            </li>
          </ul>
        </div>

      </div>

      {/* Risks */}
      <div className="border-t border-zinc-800 pt-6">
         <h3 className="text-lg font-mono font-bold text-red-400 flex items-center gap-2 mb-4">
            <ShieldAlert size={18} /> RISK VECTORS
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-zinc-500 font-mono">
            <div className="border border-zinc-800 p-3 rounded">
              <span className="text-zinc-300 block mb-1">Execution Latency</span>
              RPC nodes can be slow. We need a private RPC or Flashbots integration.
            </div>
            <div className="border border-zinc-800 p-3 rounded">
              <span className="text-zinc-300 block mb-1">Slippage</span>
              Polymarket liquidity is lower than Binance. Large orders will move the price against us.
            </div>
            <div className="border border-zinc-800 p-3 rounded">
              <span className="text-zinc-300 block mb-1">Exchange Delays</span>
              If Binance API lags, our "alpha" is gone.
            </div>
          </div>
      </div>

      {/* Action */}
      <div className="flex justify-end pt-4">
        <button 
          onClick={onProceed}
          className="group flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-md font-bold transition-all"
        >
          <Cpu className="w-5 h-5" />
          INITIATE SYSTEM DASHBOARD
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

    </div>
  );
};