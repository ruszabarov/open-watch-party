import type { ServiceId } from '@open-watch-party/shared';
import { getServiceDescriptor } from '~/streaming-services/catalog.js';

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
