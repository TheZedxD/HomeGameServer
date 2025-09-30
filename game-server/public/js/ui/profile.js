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
    if (!profile.avatar) return;
    const finalPath = path || DEFAULT_AVATAR_PATH;
    if (bustCache && typeof finalPath === 'string' && !finalPath.startsWith('data:')) {
      const url = new URL(finalPath, window.location.origin);
      url.searchParams.set('v', Date.now().toString());
      profile.avatar.src = url.pathname + url.search;
    } else {
      profile.avatar.src = finalPath;
    }
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
      modalManager.openModal(identityModal, trigger || identity.openButton || document.activeElement);
    } else {
      identityModal?.classList.remove('hidden');
      identityModal?.setAttribute('aria-hidden', 'false');
      if (trigger instanceof HTMLElement) {
        identityModal?.setAttribute('data-trigger-id', trigger.id || '');
      }
    }
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
      if (restoreFocus) {
        const triggerId = identityModal.getAttribute('data-trigger-id');
        const trigger = (triggerId && document.getElementById(triggerId)) || identity.openButton;
        trigger?.focus?.();
        identityModal.removeAttribute('data-trigger-id');
      }
    }
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
    if (file.size > 2 * 1024 * 1024) {
      toast.showToast('Avatar must be smaller than 2MB.', 'error');
      profile.avatarForm?.reset();
      return;
    }
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
    profile.avatar?.addEventListener('error', () => { profile.avatar.src = DEFAULT_AVATAR_PATH; });
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
    profile.viewProfileButton?.addEventListener('click', () => focusIdentity(profile.viewProfileButton));
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
    const cleanedName = profileManager?.sanitizeName(profileData.displayName || '') || '';
    const missingName = !cleanedName || cleanedName.toLowerCase() === DEFAULT_GUEST_NAME.toLowerCase();
    const missingAvatar = !profileData.avatarPath && !profileManager?.getStoredAvatarPath();
    if (missingName || missingAvatar) {
      if (modalManager) {
        modalManager.openModal(modal);
      } else {
        modal.classList.remove('hidden');
      }
    }
  };

  const updateProfile = (profileData) => {
    const active = profileData || profileManager?.getGuestProfile();
    const displayName = active?.displayName || DEFAULT_GUEST_NAME;
    const wins = Number.isFinite(active?.wins) ? active.wins : 0;
    const storedAvatar = profileManager?.getStoredAvatarPath();
    const avatarPath = active?.avatarPath || storedAvatar || DEFAULT_AVATAR_PATH;
    if (profile.displayName) profile.displayName.textContent = displayName;
    if (profile.wins) profile.wins.textContent = wins;
    setAvatar(avatarPath);
    if (!active?.isGuest && active?.avatarPath) profileManager?.persistLocalAvatarPath(active.avatarPath);
    if (identity.input) identity.input.value = active?.displayName || '';
    updateNamePreview(active?.displayName);
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
