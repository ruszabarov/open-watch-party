import mitt, { type Emitter } from 'mitt';
import type { PlaybackUpdateDraft } from '@open-watch-party/shared';

export type BackgroundBusEvents = {
  'controlled-tab:playback-update': {
    update: PlaybackUpdateDraft;
  };
  'session:snapshot-updated': undefined;
};

export type BackgroundBus = Emitter<BackgroundBusEvents>;

export function createBackgroundBus(): BackgroundBus {
  return mitt<BackgroundBusEvents>();
}
