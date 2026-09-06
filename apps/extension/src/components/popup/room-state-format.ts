import type { PartyMember, ServiceId } from '@open-watch-party/shared';
import { getServiceDescriptor } from '~/streaming-services/catalog.js';

export function formatPlaybackPosition(positionSec: number): string {
  const total = Number.isFinite(positionSec) ? Math.max(0, Math.floor(positionSec)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

export function resolveMediaTitle(
  title: string | undefined,
  mediaId: string,
  serviceId?: ServiceId | null,
): string {
  const trimmed = title?.trim();
  if (!trimmed) return mediaId;
  const label = serviceId ? getServiceDescriptor(serviceId)?.label : null;
  if (!label) return trimmed;
  const lower = trimmed.toLowerCase();
  const lowerLabel = label.toLowerCase();
  for (const sep of ['-', '|', '–', '—']) {
    const suffix = `${sep} ${lowerLabel}`;
    if (lower.endsWith(suffix)) {
      const stripped = trimmed.slice(0, -suffix.length).trim();
      if (stripped) return stripped;
    }
  }
  return trimmed;
}

export function resolveSourceMemberName(
  members: readonly PartyMember[],
  sourceMemberId: string,
): string {
  return members.find((member) => member.id === sourceMemberId)?.name ?? 'Unknown member';
}
