import { NETFLIX_SERVICE } from './streaming-services/netflix';
import { YOUTUBE_SERVICE } from './streaming-services/youtube';

export type ServiceDescriptor = {
  readonly label: string;
  readonly accent: string;
  readonly accentContrast: string;
  readonly glyph: string;
};

export type ServiceDefinition = {
  readonly descriptor: ServiceDescriptor;
  readonly contentMatches: readonly string[];
  matchesUrl(url: URL): boolean;
  extractMediaId(url: URL): string | null;
  isMediaIdValid(mediaId: string): boolean;
  buildCanonicalWatchUrl(mediaId: string): string;
};

export const SERVICE_BY_ID = {
  netflix: NETFLIX_SERVICE,
  youtube: YOUTUBE_SERVICE,
} satisfies Record<string, ServiceDefinition>;

export const SERVICE_DEFINITIONS = Object.values(SERVICE_BY_ID);

export type ServiceId = keyof typeof SERVICE_BY_ID;
export type ServiceUrlMatch = {
  serviceId: ServiceId;
  service: ServiceDefinition;
  isWatchPage: boolean;
};

export const SUPPORTED_SERVICE_IDS = Object.keys(SERVICE_BY_ID);

export function isServiceId(value: string): value is ServiceId {
  return value in SERVICE_BY_ID;
}

export const SUPPORTED_SERVICE_DESCRIPTORS = SERVICE_DEFINITIONS.map(
  (service) => service.descriptor,
);

export const SUPPORTED_SERVICE_CONTENT_MATCHES = SERVICE_DEFINITIONS.flatMap(
  (service) => service.contentMatches,
);

export function findServiceByUrl(url: URL): ServiceUrlMatch | undefined {
  for (const serviceId of SUPPORTED_SERVICE_IDS) {
    if (!isServiceId(serviceId)) continue;

    const service = SERVICE_BY_ID[serviceId];
    if (service.matchesUrl(url)) {
      return {
        serviceId,
        service,
        isWatchPage: service.extractMediaId(url) !== null,
      };
    }
  }

  return undefined;
}
