
import { supabase } from '../services/supabase';
import { Logger } from '../utils/logger';
import { analysisService } from '../services/analysisService';
import { ENV } from '../config/env';

export class AnalysisLoop {
  private isRunning = false;
  private readonly INTERVAL_MS = 10000; // Check every 10s
  private timeoutId: any = null;

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    Logger.info("Starting Analysis Loop...");
    this.loop();
  }

  public stop() {
    this.isRunning = false;
    if (this.timeoutId) clearTimeout(this.timeoutId);
  }

  private async loop() {
    if (!this.isRunning) return;
    await this.processPendingReports();
    this.timeoutId = setTimeout(() => this.loop(), this.INTERVAL_MS);
  }

  private async processPendingReports() {
    try {
        // Find COMPLETED runs without a report
        const { data: runs, error } = await supabase
            .from('test_runs')
            .select('id, name')
            .eq('status', 'COMPLETED')
            .is('ai_report', null)
            .limit(1); // Process one at a time to manage rate limits

        if (error) {
            Logger.error("[ANALYSIS_LOOP] DB Error", error);
            return;
        }

        if (runs && runs.length > 0) {
            const run = runs[0];
            Logger.info(`[ANALYSIS_LOOP] Generating report for ${run.name} (${run.id})...`);

            const report = await analysisService.produceAiReport(run.id);
            
            if (report) {
                await supabase
                    .from('test_runs')
                    .update({ ai_report: report })
                    .eq('id', run.id);
                Logger.info(`[ANALYSIS_LOOP] Report saved for ${run.id}`);
            }
        }
    } catch (err) {
        Logger.error("[ANALYSIS_LOOP] Error", err);
    }
  }
}
