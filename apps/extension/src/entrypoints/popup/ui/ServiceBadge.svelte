<script lang="ts">
  import type { ServiceId } from '@watch-party/shared';
  import {
    SERVICE_REGISTRY,
    getServiceDescriptor,
  } from '../../../lib/services/registry';

  interface Props {
    serviceId?: ServiceId | null;
    size?: 'sm' | 'md';
  }

  const { serviceId = null, size = 'md' }: Props = $props();

  const descriptor = $derived(
    getServiceDescriptor(serviceId) ?? SERVICE_REGISTRY.netflix,
  );
</script>

<span
  class:h-5={size === 'sm'}
  class:w-5={size === 'sm'}
  class:rounded-md={size === 'sm'}
  class:text-xs={size === 'sm'}
  class:h-8={size === 'md'}
  class:w-8={size === 'md'}
  class:rounded-lg={size === 'md'}
  class:text-lg={size === 'md'}
  class="inline-flex shrink-0 items-center justify-center leading-none font-bold [font-family:var(--font-display)] [font-variation-settings:'SOFT'_100,'opsz'_60]"
  style:background={descriptor.accent}
  style:color={descriptor.accentContrast}
  aria-label={descriptor.label}
>
  {descriptor.glyph}
</span>
