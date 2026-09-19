<script lang="ts">
  import type { ServiceId } from '@open-watch-party/shared';
  import {
    DEFAULT_SERVICE_DESCRIPTOR,
    getServiceDescriptor,
  } from '~/streaming-services/catalog.js';

  interface Props {
    serviceId?: ServiceId | null;
    size?: 'sm' | 'md';
  }

  const { serviceId = null, size = 'md' }: Props = $props();

  const descriptor = $derived(
    getServiceDescriptor(serviceId) ?? DEFAULT_SERVICE_DESCRIPTOR,
  );
</script>

<span
  role="img"
  class={[
    'inline-flex shrink-0 items-center justify-center rounded-lg leading-none font-bold',
    size === 'sm' ? 'h-6 w-6 text-xs' : 'h-9 w-9 text-lg',
  ]}
  style:background={descriptor.accent}
  style:color={descriptor.accentContrast}
  aria-label={descriptor.label}
>
  {descriptor.glyph}
</span>
