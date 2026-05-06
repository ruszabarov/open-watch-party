import mitt, { type Emitter } from 'mitt';
import type { PlaybackUpdateDraft } from '@open-watch-party/shared';
import type { WatchPageContext } from '../protocol/extension';

export type BackgroundBusEvents = {
  'controlled-tab:playback-update': {
    update: PlaybackUpdateDraft;
  };
  'controlled-tab:media-switch': {
    context: WatchPageContext;
  };
  'session:snapshot-updated': undefined;
};

export type BackgroundBus = Emitter<BackgroundBusEvents>;

export function createBackgroundBus(): BackgroundBus {
  return mitt<BackgroundBusEvents>();
}
