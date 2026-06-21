import type { PartyMember } from '@open-watch-party/shared';

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

export function resolveMediaTitle(title: string | undefined, mediaId: string): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : mediaId;
}

export function resolveSourceMemberName(
  members: readonly PartyMember[],
  sourceMemberId: string,
): string {
  return members.find((member) => member.id === sourceMemberId)?.name ?? 'Unknown member';
}
