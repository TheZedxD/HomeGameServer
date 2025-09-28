export class ErrorHandler {
  static handleFetchError(error, operation) {
    if (error?.name === 'TypeError' && typeof error.message === 'string' && error.message.includes('fetch')) {
      return `Network error during ${operation}. Please check your connection.`;
    }
    if (typeof error?.status === 'number') {
      if (error.status === 429) {
        return 'Too many requests. Please wait a moment and try again.';
      }
      if (error.status === 403) {
        return 'Access denied. Please refresh the page and try again.';
      }
      if (error.status >= 500) {
        return `Server error during ${operation}. Please try again later.`;
      }
    }
    return `An error occurred during ${operation}. Please try again.`;
  }

  static async handleAsyncOperation(operation, operationName) {
    try {
      return await operation();
    } catch (error) {
      const message = this.handleFetchError(error, operationName);
      this.showUserError(message);
      throw error;
    }
  }

  static showUserError(message) {
    if (typeof window !== 'undefined' && window.uiManager) {
      window.uiManager.showToast(message, 'error');
    } else if (typeof console !== 'undefined') {
      console.error(message);
    }
  }
}
