/**
 * Auto-assignment / blitz configuration (executive-only feature).
 * Set EXEC_AUTO_ASSIGNMENT_JSON to a JSON object (see AutoAssignmentConfig).
 */

export type AutoAssignmentConfig = {
  enabled: boolean;
  /** Processors (VA pool) for RED-tier blitz — user UUIDs. */
  redProcessorIds: string[];
  /** For ORANGE: processors when loan amount is below threshold. */
  orangeProcessorIds: string[];
  /** For ORANGE: LOs when loan amount is at or above threshold (cents). */
  orangeLoIds: string[];
  /** At or above this loan amount (cents), ORANGE routes to orangeLoIds; below to orangeProcessorIds. */
  orangeAmountThresholdCents: number;
  maxBatchSize: number;
};

const DEFAULT_MAX_BATCH = 100;

function parseUuidList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
}

export function loadAutoAssignmentConfig(): AutoAssignmentConfig | null {
  const raw = process.env.EXEC_AUTO_ASSIGNMENT_JSON?.trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const enabled = j.enabled === true;
    const redProcessorIds = parseUuidList(j.redProcessorIds);
    const orangeProcessorIds = parseUuidList(j.orangeProcessorIds);
    const orangeLoIds = parseUuidList(j.orangeLoIds);
    const orangeAmountThresholdCents =
      typeof j.orangeAmountThresholdCents === "number" && Number.isFinite(j.orangeAmountThresholdCents)
        ? Math.max(0, Math.floor(j.orangeAmountThresholdCents))
        : 0;
    const maxBatchSize =
      typeof j.maxBatchSize === "number" && Number.isFinite(j.maxBatchSize)
        ? Math.min(500, Math.max(1, Math.floor(j.maxBatchSize)))
        : DEFAULT_MAX_BATCH;
    return {
      enabled,
      redProcessorIds,
      orangeProcessorIds,
      orangeLoIds,
      orangeAmountThresholdCents,
      maxBatchSize,
    };
  } catch {
    return null;
  }
}

export function configReadyForBlitz(cfg: AutoAssignmentConfig | null): cfg is AutoAssignmentConfig {
  if (!cfg || !cfg.enabled) return false;
  if (cfg.redProcessorIds.length === 0) return false;
  if (cfg.orangeProcessorIds.length === 0 && cfg.orangeLoIds.length === 0) return false;
  return true;
}
