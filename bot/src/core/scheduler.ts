/**
 * core/scheduler.ts
 * 
 * Responsibilities:
 * 1. Manage the "tick" frequency of the bot.
 * 2. Ensure operations (like polling Supabase) don't overlap dangerously.
 */

export class Scheduler {
  private intervalId: any | null = null;

  constructor() {
    // Intentionally empty
  }

  public start(task: () => Promise<void>, intervalMs: number) {
    // Implementation to follow:
    // Run 'task' every 'intervalMs', handling async drift safely.
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}