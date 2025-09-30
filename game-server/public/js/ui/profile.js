import {
  DEFAULT_AVATAR_PATH,
  DEFAULT_GUEST_NAME,
  PROFILE_PROMPT_DISMISSED_KEY
} from '../managers/ProfileManager.js';
import { getLocalStorageItem, setLocalStorageItem } from '../utils/storage.js';
import { ErrorHandler } from '../utils/ErrorHandler.js';

export function createProfileUI(elements, toast, modalManager) {
  const { identity, profile, prompt } = elements;
  let profileManager = null;

  const setAvatar = (path, { bustCache = false } = {}) => {
    const finalPath = path || DEFAULT_AVATAR_PATH;
    let resolvedPath = finalPath;
    if (bustCache && typeof finalPath === 'string' && !finalPath.startsWith('data:')) {
      const url = new URL(finalPath, window.location.origin);
      url.searchParams.set('v', Date.now().toString());
      resolvedPath = url.pathname + url.search;
    }
    [profile.avatar, profile.avatarPreview].forEach((img) => {
      if (img) img.src = resolvedPath;
    });
  };

  const registerAvatarFallback = (img) => {
    if (!img || img.dataset.avatarFallback === 'true') return;
    img.dataset.avatarFallback = 'true';
    img.addEventListener('error', () => {
      if (img.src === DEFAULT_AVATAR_PATH) return;
      img.src = DEFAULT_AVATAR_PATH;
    });
  };

  const updateNamePreview = (name) => {
    if (identity.preview) identity.preview.textContent = name || DEFAULT_GUEST_NAME;
  };

  const showNameStatus = (message, variant = 'success') => {
    if (!identity.status) return;
    identity.status.textContent = message;
    identity.status.classList.remove('hidden', 'success', 'error');
    identity.status.classList.add(variant);
  };

  const clearNameStatus = () => {
    if (!identity.status) return;
    identity.status.classList.add('hidden');
    identity.status.textContent = '';
    identity.status.classList.remove('success', 'error');
  };

  const identityModal = elements.modals?.identityEditor;

  const openIdentityEditor = ({ trigger } = {}) => {
    clearNameStatus();
    if (modalManager && identityModal) {
      const fallbackTrigger =
        trigger || identity.openButton || profile.corner || document.activeElement;
      modalManager.openModal(identityModal, fallbackTrigger);
    } else {
      identityModal?.classList.remove('hidden');
      identityModal?.setAttribute('aria-hidden', 'false');
      if (trigger instanceof HTMLElement) {
        identityModal?.setAttribute('data-trigger-id', trigger.id || '');
      } else if (profile.corner) {
        identityModal?.setAttribute('data-trigger-id', profile.corner.id || '');
      }
    }
    profile.corner?.setAttribute('aria-expanded', 'true');
    if (identity.input) {
      identity.input.focus();
      identity.input.select();
    }
  };

  const closeIdentityEditor = ({ restoreFocus = true } = {}) => {
    if (modalManager && identityModal) {
      modalManager.closeModal(identityModal, { returnFocus: restoreFocus });
    } else if (identityModal) {
      identityModal.classList.add('hidden');
      identityModal.setAttribute('aria-hidden', 'true');
      const triggerId = identityModal.getAttribute('data-trigger-id');
      if (restoreFocus) {
        const trigger =
          (triggerId && document.getElementById(triggerId)) || identity.openButton || profile.corner;
        trigger?.focus?.();
      }
      identityModal.removeAttribute('data-trigger-id');
    }
    profile.corner?.setAttribute('aria-expanded', 'false');
  };

  const handleDisplayNameChange = async (rawValue, { showStatus = false, closeOnSuccess = false } = {}) => {
    if (!profileManager) return false;
    const result = await profileManager.updateDisplayName(rawValue);
    if (!result.success) {
      const message = result.error || 'Unable to update display name. Please try again later.';
      showStatus ? showNameStatus(message, 'error') : toast.showToast(message, 'error');
      return false;
    }
    if (showStatus) showNameStatus('Name saved!', 'success');
    else if (!result.warning) toast.showToast('Display name updated.', 'success');
    if (result.warning) toast.showToast(result.warning, 'warning', { duration: 6000 });
    if (closeOnSuccess) {
      closeIdentityEditor({ restoreFocus: true });
    }
    return true;
  };

  const bindIdentityControls = (manager) => {
    profileManager = manager;
    const storedName = manager.getStoredDisplayName();
    if (storedName) {
      updateNamePreview(storedName);
      if (identity.input) identity.input.value = storedName;
    } else {
      updateNamePreview(DEFAULT_GUEST_NAME);
    }
    identityModal?.addEventListener('modal:opened', () => {
      profile.corner?.setAttribute('aria-expanded', 'true');
    });
    identityModal?.addEventListener('modal:closed', () => {
      profile.corner?.setAttribute('aria-expanded', 'false');
    });
    identity.openButton?.addEventListener('click', () => openIdentityEditor({ trigger: identity.openButton }));
    identity.closeButton?.addEventListener('click', () => closeIdentityEditor());
    identity.cancelButton?.addEventListener('click', () => closeIdentityEditor());
    identity.saveButton?.addEventListener('click', () =>
      handleDisplayNameChange(identity.input?.value ?? '', { showStatus: true })
    );
    identity.input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleDisplayNameChange(identity.input.value, { showStatus: true });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeIdentityEditor({ restoreFocus: true });
      }
    });
    identity.input?.addEventListener('input', clearNameStatus);
  };

  const handleAvatarSelection = async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;

    const currentAvatarSrc = profile.avatarPreview?.src || DEFAULT_AVATAR_PATH;

    if (file.size > 2 * 1024 * 1024) {
      toast.showToast('Avatar must be smaller than 2MB.', 'error');
      profile.avatarForm?.reset();
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (profile.avatarPreview) {
        profile.avatarPreview.src = e.target.result;
      }
      if (profile.avatar) {
        profile.avatar.src = e.target.result;
      }
    };
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const response = await profileManager.csrfFetch(
        '/api/profile/avatar',
        { method: 'POST', body: formData },
        { operationName: 'avatar upload', showUserError: false }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Upload failed');
      }

      const data = await response.json();
      if (!data?.avatarPath) throw new Error('Upload did not return an avatar path.');

      setAvatar(data.avatarPath, { bustCache: true });
      profileManager.persistLocalAvatarPath(data.avatarPath);
      toast.showToast('Avatar updated successfully.', 'success');
      hideProfilePrompt(true);

      if (profileManager.profile) {
        profileManager.profile.avatarPath = data.avatarPath;
        profileManager.profile.isGuest = false;
        profileManager.notifyObservers();
      }
    } catch (error) {
      console.error('Avatar upload failed.', error);
      const message = ErrorHandler.handleFetchError(error, 'avatar upload');
      toast.showToast(message, 'error');

      if (profile.avatarPreview) {
        profile.avatarPreview.src = currentAvatarSrc;
      }
      if (profile.avatar) {
        profile.avatar.src = currentAvatarSrc;
      }
    } finally {
      profile.avatarForm?.reset();
    }
  };

  const hideProfilePrompt = (remember = false, { restoreFocus = true } = {}) => {
    const modal = elements.modals.profilePrompt;
    if (modalManager && modal) {
      modalManager.closeModal(modal, { returnFocus: restoreFocus });
    } else {
      modal?.classList.add('hidden');
    }
    if (remember) setLocalStorageItem(PROFILE_PROMPT_DISMISSED_KEY, 'true');
  };

  const bindProfileEvents = (manager, { onLeaveGame } = {}) => {
    profileManager = manager;
    registerAvatarFallback(profile.avatar);
    registerAvatarFallback(profile.avatarPreview);
    profile.signInButton?.addEventListener('click', () => { window.location.href = '/login'; });
    profile.signOutButton?.addEventListener('click', async () => {
      try {
        await manager.csrfFetch(
          '/logout',
          { method: 'POST' },
          { operationName: 'logout', showUserError: false }
        );
      } catch (error) {
        console.warn('Failed to log out gracefully.', error);
        const message = ErrorHandler.handleFetchError(error, 'logout');
        toast.showToast(message, 'error');
      }
      window.location.href = '/login';
    });
    profile.changeAvatarButton?.addEventListener('click', () => profile.avatarInput?.click());
    profile.avatarInput?.addEventListener('change', handleAvatarSelection);
    const focusIdentity = (trigger) => {
      hideProfilePrompt(false, { restoreFocus: false });
      openIdentityEditor({ trigger });
    };
    const handleCornerActivate = (event) => {
      if (event.type === 'keydown') {
        const key = event.key;
        if (key !== 'Enter' && key !== ' ') return;
        event.preventDefault();
      }
      focusIdentity(profile.corner);
    };
    profile.corner?.addEventListener('click', handleCornerActivate);
    profile.corner?.addEventListener('keydown', handleCornerActivate);
    prompt.editButton?.addEventListener('click', () => focusIdentity(prompt.editButton));
    prompt.dismissButton?.addEventListener('click', () => hideProfilePrompt(true));
    elements.game.exitButton?.addEventListener('click', () => onLeaveGame?.());
    elements.game.gameOverExitButton?.addEventListener('click', () => {
      onLeaveGame?.();
      if (modalManager && elements.modals.gameOver) {
        modalManager.closeModal(elements.modals.gameOver);
      } else {
        elements.modals.gameOver?.classList.add('hidden');
      }
    });
  };

  const maybeShowProfilePrompt = (profileData) => {
    const modal = elements.modals.profilePrompt;
    if (!modal) return;

    const dismissed = getLocalStorageItem(PROFILE_PROMPT_DISMISSED_KEY) === 'true';
    if (dismissed || !profileData || profileData.isGuest) return;

    const isInGame = document.getElementById('game-ui')?.classList.contains('hidden') === false;
    if (isInGame) {
      console.debug('Suppressing profile prompt during active game');
      return;
    }

    const cleanedName = profileManager?.sanitizeName(profileData.displayName || '') || '';
    const missingName = !cleanedName || cleanedName.toLowerCase() === DEFAULT_GUEST_NAME.toLowerCase();
    const missingAvatar = !profileData.avatarPath && !profileManager?.getStoredAvatarPath();

    if (missingName || missingAvatar) {
      setTimeout(() => {
        if (modalManager) {
          modalManager.openModal(modal);
        } else {
          modal.classList.remove('hidden');
        }
      }, 500);
    }
  };

  const updateProfile = (profileData) => {
    const active = profileData || profileManager?.getGuestProfile();
    const rawName = active?.displayName || DEFAULT_GUEST_NAME;
    const displayName = (profileManager?.sanitizeName?.(rawName) || rawName || '').trim() || DEFAULT_GUEST_NAME;
    const wins = Number.isFinite(active?.wins) ? active.wins : 0;
    const storedAvatar = profileManager?.getStoredAvatarPath();
    const avatarPath = active?.avatarPath || storedAvatar || DEFAULT_AVATAR_PATH;
    if (profile.displayName) profile.displayName.textContent = displayName;
    if (profile.overlayDisplayName) profile.overlayDisplayName.textContent = displayName;
    if (profile.wins) profile.wins.textContent = wins;
    if (profile.overlayWins) profile.overlayWins.textContent = wins;
    if (profile.corner) {
      profile.corner.setAttribute('aria-label', `Open profile preferences for ${displayName}`);
    }
    setAvatar(avatarPath);
    if (!active?.isGuest && active?.avatarPath) profileManager?.persistLocalAvatarPath(active.avatarPath);
    if (identity.input) {
      const cleanedInput = active?.displayName
        ? profileManager?.sanitizeName?.(active.displayName) || active.displayName
        : '';
      identity.input.value = cleanedInput;
    }
    updateNamePreview(displayName);
  };

  const toggleProfileActions = (authenticated) => {
    const { signInButton, signOutButton } = profile;
    if (!signInButton || !signOutButton) return;
    signInButton.classList.toggle('hidden', authenticated);
    signOutButton.classList.toggle('hidden', !authenticated);
  };

  return {
    bindIdentityControls,
    bindProfileEvents,
    updateProfile,
    toggleProfileActions,
    maybeShowProfilePrompt,
    hideProfilePrompt,
    clearNameStatus,
    updateNamePreview
  };
}
