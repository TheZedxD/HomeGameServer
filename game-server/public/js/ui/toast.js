export function createToastManager(container) {
  const MAX_TOASTS = 5;
  const activeToasts = [];

  function showToast(message, variant = 'info', options = {}) {
    if (!container) return;

    if (activeToasts.length >= MAX_TOASTS) {
      const oldest = activeToasts.shift();
      if (oldest?.parentNode) {
        oldest.remove();
      }
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${variant}`;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;
    container.appendChild(toast);
    activeToasts.push(toast);

    const removeToast = () => {
      const index = activeToasts.indexOf(toast);
      if (index > -1) {
        activeToasts.splice(index, 1);
      }
      if (toast.parentNode) {
        toast.remove();
      }
    };

    const duration = typeof options.duration === 'number' ? options.duration : 4000;
    if (duration !== Infinity) {
      const timeout = setTimeout(removeToast, Math.max(1000, duration));
      toast.addEventListener('click', () => {
        clearTimeout(timeout);
        removeToast();
      });
    } else {
      toast.addEventListener('click', removeToast);
    }
  }

  return { showToast };
}
