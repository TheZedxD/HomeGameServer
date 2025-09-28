export function initializeWindowControls(uiManager) {
  const headerWindow = document.querySelector('.header .window');
  if (!headerWindow) return;

  const minimizeButton = headerWindow.querySelector('[aria-label="Minimize"]');
  const maximizeButton = headerWindow.querySelector('[aria-label="Maximize"]');
  const closeButton = headerWindow.querySelector('[aria-label="Close"]');
  const windowBody = headerWindow.querySelector('.window-body');
  const headerContainer = headerWindow.parentElement;

  if (!windowBody || !headerContainer) return;

  const minimizeDefaultText = minimizeButton?.textContent ?? '_';
  const maximizeDefaultText = maximizeButton?.textContent ?? '□';

  const restoreButton = document.createElement('button');
  restoreButton.type = 'button';
  restoreButton.className = 'btn btn-secondary header-restore-btn hidden';
  restoreButton.textContent = 'Restore Header';
  restoreButton.setAttribute('aria-label', 'Restore header panel');
  headerContainer.appendChild(restoreButton);

  let isCollapsed = false;
  let isMaximized = false;

  const updateMinimizeLabel = () => {
    const label = isCollapsed ? 'Restore panel' : 'Minimize panel';
    minimizeButton?.setAttribute('aria-label', label);
  };

  const updateMaximizeLabel = () => {
    const label = isMaximized ? 'Exit maximized view' : 'Maximize panel';
    maximizeButton?.setAttribute('aria-label', label);
  };

  minimizeButton?.addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    windowBody.classList.toggle('collapsed', isCollapsed);
    minimizeButton.textContent = isCollapsed ? '▢' : minimizeDefaultText;
    minimizeButton.setAttribute('aria-pressed', String(isCollapsed));
    updateMinimizeLabel();
    if (isCollapsed) {
      uiManager?.showToast('Header collapsed.', 'info', { duration: 2000 });
    } else {
      uiManager?.showToast('Header expanded.', 'info', { duration: 2000 });
    }
  });

  maximizeButton?.addEventListener('click', () => {
    isMaximized = !isMaximized;
    headerWindow.classList.toggle('window--maximized', isMaximized);
    maximizeButton.textContent = isMaximized ? '❐' : maximizeDefaultText;
    maximizeButton.setAttribute('aria-pressed', String(isMaximized));
    updateMaximizeLabel();
  });

  closeButton?.addEventListener('click', () => {
    headerWindow.classList.add('hidden');
    restoreButton.classList.remove('hidden');
    closeButton.disabled = true;
    closeButton.setAttribute('aria-disabled', 'true');
    uiManager?.showToast('Header hidden. Use Restore Header to show it again.', 'info', {
      duration: 3000
    });
  });

  restoreButton.addEventListener('click', () => {
    headerWindow.classList.remove('hidden');
    restoreButton.classList.add('hidden');
    if (isCollapsed) {
      isCollapsed = false;
      windowBody.classList.remove('collapsed');
      minimizeButton.textContent = minimizeDefaultText;
      minimizeButton?.setAttribute('aria-pressed', 'false');
      updateMinimizeLabel();
    }
    if (isMaximized) {
      isMaximized = false;
      headerWindow.classList.remove('window--maximized');
      maximizeButton.textContent = maximizeDefaultText;
      maximizeButton?.setAttribute('aria-pressed', 'false');
      updateMaximizeLabel();
    }
    closeButton?.removeAttribute('aria-disabled');
    if (closeButton) closeButton.disabled = false;
    uiManager?.showToast('Header restored.', 'success', { duration: 2000 });
  });

  updateMinimizeLabel();
  updateMaximizeLabel();
}
