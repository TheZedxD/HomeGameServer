// ============================================================================
// ProfileManager - Constants and Profile Management
// ============================================================================

export const DEFAULT_GUEST_NAME = 'Guest';
export const INSTALL_FLAG_KEY = 'homegameserver_installed';
export const DEFAULT_AVATAR_PATH = '/assets/default-avatar.png';
export const PROFILE_PROMPT_DISMISSED_KEY = 'homegameserver_profile_dismissed';

// Simple profile management
export class ProfileManager {
  constructor(storage) {
    this.storage = storage;
    this.profile = null;
  }

  loadProfile() {
    const username = this.storage?.getUsername();
    if (username) {
      this.profile = {
        username,
        displayName: username,
      };
    } else {
      this.profile = this.getGuestProfile();
    }
    return this.profile;
  }

  getGuestProfile() {
    return {
      username: DEFAULT_GUEST_NAME + Math.random().toString(36).substring(2, 6),
      displayName: DEFAULT_GUEST_NAME,
    };
  }

  sanitizeName(name) {
    if (!name || typeof name !== 'string') {
      return '';
    }
    return name
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .substring(0, 24);
  }

  setProfile(profile) {
    this.profile = profile;
    if (profile?.username && this.storage) {
      this.storage.setUsername(profile.username);
    }
  }
}
