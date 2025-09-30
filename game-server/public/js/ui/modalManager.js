const FOCUSABLE_SELECTORS = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

function getFocusableElements(modal) {
  if (!modal) return [];
  return Array.from(modal.querySelectorAll(FOCUSABLE_SELECTORS)).filter((element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.tabIndex < 0) return false;
    if (element.hasAttribute('disabled')) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  });
}

export function createModalManager({ modals = {} } = {}) {
  const modalState = new Map();
  let activeModal = null;

  function ensureRegistration(modal) {
    if (!modal) return;
    if (modalState.has(modal)) {
      return;
    }

    const state = { trigger: null };

    const handleKeydown = (event) => {
      if (!activeModal || activeModal !== modal) return;
      if (event.key === 'Tab') {
        const focusable = getFocusableElements(modal);
        if (!focusable.length) {
          event.preventDefault();
          modal.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeElement = document.activeElement;
        if (event.shiftKey) {
          if (!modal.contains(activeElement) || activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (!modal.contains(activeElement) || activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal(modal);
      }
    };

    modal.addEventListener('keydown', handleKeydown);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });

    modal.setAttribute('aria-hidden', modal.classList.contains('hidden') ? 'true' : 'false');

    modalState.set(modal, { ...state, handleKeydown });
  }

  function focusFirstElement(modal) {
    const applyFocus = () => {
      const focusable = getFocusableElements(modal);
      const target = (focusable.length ? focusable[0] : modal);
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    };
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(applyFocus);
    } else {
      setTimeout(applyFocus, 0);
    }
  }

  function openModal(modal, trigger = document.activeElement) {
    if (!modal) return;
    ensureRegistration(modal);
    const state = modalState.get(modal);
    if (activeModal && activeModal !== modal) {
      closeModal(activeModal, { returnFocus: false });
    }
    state.trigger = trigger instanceof HTMLElement ? trigger : null;
    activeModal = modal;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.dispatchEvent(
      new CustomEvent('modal:opened', {
        bubbles: false,
        detail: { trigger: state.trigger }
      })
    );
    focusFirstElement(modal);
  }

  function closeModal(modal, { returnFocus = true } = {}) {
    if (!modal) return;
    ensureRegistration(modal);
    const state = modalState.get(modal);
    if (!state) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    modal.dispatchEvent(
      new CustomEvent('modal:closed', {
        bubbles: false,
        detail: { returnFocus }
      })
    );
    if (activeModal === modal) {
      activeModal = null;
    }
    const { trigger } = state;
    state.trigger = null;
    if (returnFocus && trigger && typeof trigger.focus === 'function') {
      trigger.focus();
    }
  }

  Object.values(modals || {}).forEach((modal) => ensureRegistration(modal));

  return {
    openModal,
    closeModal,
    registerModal: ensureRegistration
  };
}
