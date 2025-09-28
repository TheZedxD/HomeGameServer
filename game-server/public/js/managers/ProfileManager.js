import { sanitizeName } from '../utils/validation.js';
import { CsrfService } from '../utils/csrf.js';
import {
  getLocalStorageItem,
  setLocalStorageItem,
  removeLocalStorageItem
} from '../utils/storage.js';

export const NAME_STORAGE_KEY = 'homegame.displayName';
export const AVATAR_STORAGE_KEY = 'homegame.avatarPath';
export const INSTALL_FLAG_KEY = 'homegame.installFlag';
export const PROFILE_PROMPT_DISMISSED_KEY = 'homegame.profilePromptDismissed';
export const DEFAULT_AVATAR_PATH = '/images/default-avatar.svg';
export const DEFAULT_GUEST_NAME = 'Guest';

export class ProfileManager {
  constructor() {
    this.profile = this.getGuestProfile();
    this.observers = [];
    this.csrfService = new CsrfService((token) => this.updateCsrfFields(token));
  }

  sanitizeName(rawName) {
    return sanitizeName(rawName);
  }

  validateDisplayName(rawName) {
    const cleaned = this.sanitizeName(rawName);
    if (!cleaned) {
      return { valid: false, message: 'Display name must contain at least one visible character.' };
    }
    if (cleaned.length > 24) {
      return { valid: false, message: 'Display name must be 24 characters or fewer.' };
    }
    const validCharacters = /^[\p{L}\p{N} _'’.-]+$/u;
    if (!validCharacters.test(cleaned)) {
      return { valid: false, message: 'Display name contains unsupported characters.' };
    }
    return { valid: true, value: cleaned };
  }

  getStoredDisplayName() {
    return this.sanitizeName(getLocalStorageItem(NAME_STORAGE_KEY) || '').slice(0, 24);
  }

  storeDisplayName(name) {
    if (!name) {
      removeLocalStorageItem(NAME_STORAGE_KEY);
    } else {
      setLocalStorageItem(NAME_STORAGE_KEY, name);
    }
  }

  getStoredAvatarPath() {
    return getLocalStorageItem(AVATAR_STORAGE_KEY);
  }

  persistLocalAvatarPath(path) {
    if (path) {
      setLocalStorageItem(AVATAR_STORAGE_KEY, path);
    }
  }

  clearStoredAvatarPath() {
    removeLocalStorageItem(AVATAR_STORAGE_KEY);
  }

  normalizeProfile(rawProfile, { isGuest = false } = {}) {
    if (!rawProfile) {
      return this.getGuestProfile();
    }
    const username = this.sanitizeName(rawProfile.username || '').slice(0, 24) || DEFAULT_GUEST_NAME;
    const fallbackDisplayName = isGuest ? username || DEFAULT_GUEST_NAME : username;
    const displayName = this.sanitizeName(rawProfile.displayName || fallbackDisplayName).slice(0, 24) || DEFAULT_GUEST_NAME;
    const wins = Number(rawProfile.wins);
    return {
      isGuest,
      username: isGuest ? DEFAULT_GUEST_NAME : username,
      displayName,
      wins: Number.isFinite(wins) ? Math.max(0, Math.floor(wins)) : 0,
      avatarPath: rawProfile.avatarPath || null
    };
  }

  getGuestProfile() {
    const storedName = this.getStoredDisplayName();
    return {
      isGuest: true,
      username: DEFAULT_GUEST_NAME,
      displayName: storedName || DEFAULT_GUEST_NAME,
      wins: 0,
      avatarPath: this.getStoredAvatarPath()
    };
  }

  async loadProfile() {
    try {
      const response = await fetch('/api/session', { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error('Unable to load profile.');
      }
      const data = await response.json();
      if (data?.authenticated && data.user) {
        this.profile = this.normalizeProfile(data.user, { isGuest: false });
        this.storeDisplayName(this.profile.displayName);
      } else {
        this.profile = this.getGuestProfile();
      }
    } catch (error) {
      console.warn('Failed to load session profile.', error);
      if (!this.profile || !this.profile.isGuest) {
        this.profile = this.getGuestProfile();
      }
    }
    this.notifyObservers();
    return this.profile;
  }

  async updateDisplayName(name) {
    const validation = this.validateDisplayName(name);
    if (!validation.valid) {
      return { success: false, error: validation.message };
    }

    const sanitized = validation.value;
    if (!this.profile) {
      this.profile = this.getGuestProfile();
    }

    this.profile.displayName = sanitized;
    this.storeDisplayName(sanitized);
    this.notifyObservers();

    if (!this.profile.isGuest) {
      try {
        const response = await this.csrfFetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: sanitized })
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Request failed');
        }
      } catch (error) {
        console.warn('Failed to save to server:', error);
        return {
          success: true,
          warning: 'Saved locally, but syncing with the server failed. Please try again later.'
        };
      }
    }

    return { success: true };
  }

  subscribe(callback) {
    if (typeof callback === 'function') {
      this.observers.push(callback);
    }
  }

  notifyObservers() {
    this.observers.forEach((callback) => {
      try {
        callback(this.profile);
      } catch (error) {
        console.warn('Profile observer failed.', error);
      }
    });
  }

  updateCsrfFields(token) {
    document.querySelectorAll('input[name="_csrf"]').forEach((field) => {
      field.value = token || '';
    });
  }

  ensureCsrfToken(force = false) {
    return this.csrfService.ensureToken(force);
  }

  csrfFetch(input, init = {}, options) {
    return this.csrfService.fetch(input, init, options);
  }
}
