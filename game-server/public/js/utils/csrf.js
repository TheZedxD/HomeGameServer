import { ErrorHandler } from './ErrorHandler.js';

function cloneRequestOptions(init = {}) {
  const options = { ...init };

  if (init.headers instanceof Headers) {
    const headers = {};
    init.headers.forEach((value, key) => {
      headers[key] = value;
    });
    options.headers = headers;
  } else if (Array.isArray(init.headers)) {
    options.headers = init.headers.reduce((acc, entry) => {
      if (Array.isArray(entry) && entry.length >= 2) {
        const [key, value] = entry;
        acc[key] = value;
      }
      return acc;
    }, {});
  } else {
    options.headers = init.headers ? { ...init.headers } : {};
  }

  if (init.body instanceof FormData) {
    const formData = new FormData();
    init.body.forEach((value, key) => {
      if (value instanceof File) {
        formData.append(key, value, value.name);
      } else {
        formData.append(key, value);
      }
    });
    options.body = formData;
  } else {
    options.body = init.body;
  }

  return options;
}

function attachCsrfToken(options, token) {
  if (!token) return;
  if (!options.headers || typeof options.headers !== 'object') {
    options.headers = {};
  }
  options.headers['X-CSRF-Token'] = token;
  if (options.body instanceof FormData) {
    options.body.set('_csrf', token);
  }
}

export class CsrfService {
  constructor(updateFields) {
    this.token = '';
    this.tokenPromise = null;
    this.updateFields = updateFields;
  }

  setToken(token) {
    this.token = token || '';
    this.updateFields?.(this.token);
    return this.token;
  }

  async ensureToken(force = false) {
    if (force) {
      this.token = '';
      this.tokenPromise = null;
    }

    if (this.token && !force) {
      return this.token;
    }

    if (!this.tokenPromise) {
      this.tokenPromise = ErrorHandler.handleAsyncOperation(async () => {
        const response = await fetch('/api/csrf-token', {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        const data = await response.json();
        const token = typeof data?.token === 'string' ? data.token : '';
        this.setToken(token);
        return token;
      }, 'CSRF token retrieval').catch((error) => {
        this.tokenPromise = null;
        this.setToken('');
        throw error;
      });
    }

    try {
      return await this.tokenPromise;
    } finally {
      if (!this.token) {
        this.tokenPromise = null;
      }
    }
  }

  async fetch(input, init = {}, { retry = true, operationName = 'request', showUserError = true } = {}) {
    try {
      const token = await this.ensureToken();
      const options = cloneRequestOptions(init);
      attachCsrfToken(options, token);
      const executeFetch = async () => fetch(input, options);
      const response = showUserError
        ? await ErrorHandler.handleAsyncOperation(executeFetch, operationName)
        : await executeFetch();
      if (response.status === 403 && retry) {
        await this.ensureToken(true);
        return this.fetch(input, init, { retry: false, operationName, showUserError });
      }
      return response;
    } catch (error) {
      if (retry) {
        try {
          await this.ensureToken(true);
        } catch (refreshError) {
          console.warn('Failed to refresh CSRF token.', refreshError);
        }
      }
      throw error;
    }
  }
}
