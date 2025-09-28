import { ErrorHandler } from '../utils/ErrorHandler.js';
import { validateForm } from '../utils/validation.js';

function ensureErrorContainer(form) {
  const existing = form.querySelector('.form-errors');
  if (existing) {
    return existing;
  }
  const container = document.createElement('div');
  container.className = 'form-errors hidden';
  container.setAttribute('role', 'alert');
  container.setAttribute('aria-live', 'assertive');
  form.insertBefore(container, form.children[2] || null);
  return container;
}

function displayErrors(container, errors) {
  if (!container) return;
  if (!errors.length) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  container.innerHTML = errors.map((message) => `<p>${message}</p>`).join('');
  container.classList.remove('hidden');
}

function getValidationRules(form) {
  const usernameRule = {
    required: true,
    displayName: 'Username',
    pattern: /^[A-Za-z0-9_-]+$/,
    patternError: 'Username may only contain letters, numbers, hyphens, and underscores.'
  };
  const passwordRule = {
    required: true,
    displayName: 'Password',
    minLength: 6
  };

  const rules = {
    username: usernameRule,
    password: passwordRule
  };

  if (form.querySelector('[name="displayName"]')) {
    rules.displayName = {
      displayName: 'Display name',
      minLength: 2,
      pattern: /^[\p{L}\p{N} _'’.-]+$/u,
      patternError: 'Display name contains unsupported characters.'
    };
  }

  return rules;
}

async function loadCsrfToken(field, errorContainer) {
  if (!field) return;
  try {
    const data = await ErrorHandler.handleAsyncOperation(async () => {
      const response = await fetch('/api/csrf-token', {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    }, 'CSRF token retrieval');
    field.value = typeof data?.token === 'string' ? data.token : '';
    if (!field.value) {
      displayErrors(errorContainer, ['Unable to retrieve a security token. Please refresh and try again.']);
    }
  } catch (error) {
    console.error('Unable to load CSRF token.', error);
    field.value = '';
    const message = ErrorHandler.handleFetchError(error, 'CSRF token retrieval');
    displayErrors(errorContainer, [message]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('.auth-form');
  if (!form) {
    return;
  }

  const errorContainer = ensureErrorContainer(form);
  displayErrors(errorContainer, []);

  const csrfField = document.getElementById('csrf-token');
  loadCsrfToken(csrfField, errorContainer);

  const validationRules = getValidationRules(form);
  form.addEventListener('submit', (event) => {
    const formData = Object.fromEntries(new FormData(form).entries());
    const errors = validateForm(formData, validationRules);
    if (errors.length) {
      event.preventDefault();
      displayErrors(errorContainer, errors);
    } else {
      displayErrors(errorContainer, []);
    }
  });
});
