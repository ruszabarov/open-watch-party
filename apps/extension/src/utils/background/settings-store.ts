import { localExtStorage } from '@webext-core/storage';

import type { InternalState, SessionInfo, StoredSettings } from './state';
import { normalizeMemberName, normalizeServerUrl } from './state';

const SETTINGS_KEY = 'watch-party-settings';

export class SettingsStore {
  constructor(private readonly state: InternalState) {}

  async hydrate(): Promise<void> {
    const stored = (await localExtStorage.getItem(SETTINGS_KEY)) as StoredSettings | null;

    if (!stored) {
      await this.persist();
      return;
    }

    this.state.settings.memberName = normalizeMemberName(stored.memberName);
    this.state.settings.serverUrl = normalizeServerUrl(stored.serverUrl);
    this.state.session = stored.session;
    this.state.roomMemberId = this.state.session?.memberId ?? null;
  }

  async updateSettings(next: { serverUrl: string; memberName: string }): Promise<void> {
    this.state.settings = {
      serverUrl: normalizeServerUrl(next.serverUrl),
      memberName: normalizeMemberName(next.memberName),
    };
    await this.persist();
  }

  async persistSession(session: SessionInfo | null): Promise<void> {
    this.state.session = session;
    this.state.roomMemberId = session?.memberId ?? null;
    await this.persist();
  }

  async persist(): Promise<void> {
    const storedSettings: StoredSettings = {
      memberName: this.state.settings.memberName,
      serverUrl: this.state.settings.serverUrl,
      session: this.state.session,
    };

    await localExtStorage.setItem(SETTINGS_KEY, storedSettings);
  }
}
