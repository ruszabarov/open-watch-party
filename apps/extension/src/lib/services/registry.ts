import type { ServiceId } from '@watch-party/shared';

/**
 * Visual + copy metadata for a streaming service. The popup UI renders every
 * service through these descriptors so new integrations only need to add an
 * entry here (and a runtime adapter in `./<service>.ts`).
 *
 * Contributing a service:
 *   1. Add a new `ServiceId` in `packages/shared/src/protocol.ts`.
 *   2. Implement an adapter under `apps/extension/src/lib/services/<id>.ts`.
 *   3. Register the content script entrypoint under `src/entrypoints/`.
 *   4. Append a `ServiceDescriptor` to `SERVICE_REGISTRY` below — the popup
 *      picks up labels, colors, and icons automatically.
 */
export interface ServiceDescriptor {
	readonly id: ServiceId;
	readonly label: string;
	readonly accent: string;
	readonly accentContrast: string;
	readonly glyph: string;
	readonly watchPathHint: string;
}

const NETFLIX: ServiceDescriptor = {
	id: 'netflix',
	label: 'Netflix',
	accent: '#e50914',
	accentContrast: '#ffffff',
	glyph: 'N',
	watchPathHint: 'netflix.com/watch/…',
};

export const SERVICE_REGISTRY: Record<ServiceId, ServiceDescriptor> = {
	netflix: NETFLIX,
};

export const SUPPORTED_SERVICE_DESCRIPTORS: readonly ServiceDescriptor[] =
	Object.values(SERVICE_REGISTRY);

export function getServiceDescriptor(
	id: ServiceId | null | undefined,
): ServiceDescriptor | null {
	if (!id) {
		return null;
	}

	return SERVICE_REGISTRY[id] ?? null;
}
