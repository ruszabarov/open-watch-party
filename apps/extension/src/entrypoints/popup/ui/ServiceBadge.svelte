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
  class="badge badge--{size}"
  style:background={descriptor.accent}
  style:color={descriptor.accentContrast}
  aria-label={descriptor.label}
>
  {descriptor.glyph}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display);
    font-weight: 700;
    font-variation-settings: 'SOFT' 100, 'opsz' 60;
    line-height: 1;
    flex-shrink: 0;
  }

  .badge--sm {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    font-size: 0.72rem;
  }

  .badge--md {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    font-size: 1.1rem;
  }
</style>
