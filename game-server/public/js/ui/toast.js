export function createToastManager(container) {
  function showToast(message, variant = 'info', options = {}) {
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${variant}`;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;
    container.appendChild(toast);

    const duration = typeof options.duration === 'number' ? options.duration : 4000;
    if (duration !== Infinity) {
      const timeout = setTimeout(() => toast.remove(), Math.max(1000, duration));
      toast.addEventListener('click', () => {
        clearTimeout(timeout);
        toast.remove();
      });
    } else {
      toast.addEventListener('click', () => toast.remove());
    }
  }

  return { showToast };
}
