export const Logger = {
  info: (msg: string, meta?: any) => {
    console.log(`[INFO] ${new Date().toISOString()}: ${msg}`, meta || '');
  },
  warn: (msg: string, meta?: any) => {
    console.warn(`[WARN] ${new Date().toISOString()}: ${msg}`, meta || '');
  },
  error: (msg: string, err?: any) => {
    console.error(`[ERROR] ${new Date().toISOString()}: ${msg}`, err || '');
  }
};
