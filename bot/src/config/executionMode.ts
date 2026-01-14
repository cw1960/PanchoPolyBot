
import { Logger } from '../utils/logger';

export type ExecutionMode = 'LIVE' | 'PAPER';

export const EXECUTION_MODE: ExecutionMode = (() => {
  const rawMode = process.env.EXECUTION_MODE || 'PAPER';
  
  if (rawMode !== 'LIVE' && rawMode !== 'PAPER') {
    throw new Error(`[CONFIG_FATAL] Invalid EXECUTION_MODE="${rawMode}". Must be "LIVE" or "PAPER".`);
  }

  Logger.info(`[MODE] EXECUTION_MODE=${rawMode}`);
  return rawMode as ExecutionMode;
})();
