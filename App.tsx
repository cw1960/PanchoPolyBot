import React, { useState } from 'react';
import { PlanView } from './components/PlanView';
import { Dashboard } from './components/Dashboard';
import { AppState } from './types';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.PLANNING);

  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-emerald-500/30">
      {appState === AppState.PLANNING ? (
        <div className="min-h-screen flex items-center justify-center py-12">
          <PlanView onProceed={() => setAppState(AppState.DASHBOARD)} />
        </div>
      ) : (
        <Dashboard />
      )}
    </div>
  );
};

export default App;