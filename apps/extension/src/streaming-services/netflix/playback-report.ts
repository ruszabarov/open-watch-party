import type { WatchReport } from '../../messaging';

export const NETFLIX_POSITION_DRIFT_THRESHOLD_SEC = 1.5;

export type NetflixPlaybackSyncPoint = {
  report: WatchReport;
  observedAtMs: number;
};

export function createNetflixPlaybackSyncPoint(
  report: WatchReport,
  observedAtMs: number,
): NetflixPlaybackSyncPoint {
  return {
    report,
    observedAtMs,
  };
}

export function shouldSendNetflixPlaybackReport(
  report: WatchReport,
  lastSyncPoint: NetflixPlaybackSyncPoint | null,
  observedAtMs: number,
): boolean {
  if (!lastSyncPoint) return true;

  const lastReport = lastSyncPoint.report;
  if (report.serviceId !== lastReport.serviceId || report.mediaId !== lastReport.mediaId) {
    return true;
  }

  if ((report.title ?? '') !== (lastReport.title ?? '')) {
    return true;
  }

  if (report.playing !== lastReport.playing) {
    return true;
  }

  const expectedPositionSec = lastReport.playing
    ? lastReport.positionSec + Math.max(0, observedAtMs - lastSyncPoint.observedAtMs) / 1000
    : lastReport.positionSec;

  return Math.abs(report.positionSec - expectedPositionSec) >= NETFLIX_POSITION_DRIFT_THRESHOLD_SEC;
}
