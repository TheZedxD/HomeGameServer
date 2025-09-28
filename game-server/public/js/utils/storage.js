export function getLocalStorageItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

export function setLocalStorageItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('Unable to persist localStorage value.', error);
  }
}

export function removeLocalStorageItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('Unable to remove localStorage value.', error);
  }
}
