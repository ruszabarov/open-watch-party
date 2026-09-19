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

// Single source of truth for supported services. The protocol schema, the
// popup, and the extension catalog all derive from this registry.
export const SERVICE_IDS = ['netflix', 'youtube'] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

export const SERVICE_BY_ID = {
  netflix: NETFLIX_SERVICE,
  youtube: YOUTUBE_SERVICE,
} satisfies Record<ServiceId, ServiceDefinition>;

export const SERVICE_DEFINITIONS = SERVICE_IDS.map((id) => SERVICE_BY_ID[id]);

export type ServiceUrlMatch = {
  serviceId: ServiceId;
  service: ServiceDefinition;
  isWatchPage: boolean;
};

export const SUPPORTED_SERVICE_IDS = SERVICE_IDS;

export function isServiceId(value: string): value is ServiceId {
  return Object.hasOwn(SERVICE_BY_ID, value);
}

export const SUPPORTED_SERVICE_DESCRIPTORS = SERVICE_DEFINITIONS.map(
  (service) => service.descriptor,
);

export const DEFAULT_SERVICE_DESCRIPTOR: ServiceDescriptor =
  SERVICE_BY_ID[SERVICE_IDS[0]].descriptor;

export const SUPPORTED_SERVICE_CONTENT_MATCHES = SERVICE_DEFINITIONS.flatMap(
  (service) => service.contentMatches,
);

export function findServiceByUrl(url: URL): ServiceUrlMatch | undefined {
  for (const serviceId of SERVICE_IDS) {
    const service: ServiceDefinition = SERVICE_BY_ID[serviceId];
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
