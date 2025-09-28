const WHITESPACE_REGEX = /[\r\n]+/g;
const MULTISPACE_REGEX = /\s+/g;

export function sanitizeName(rawName) {
  if (rawName === null || rawName === undefined) {
    return '';
  }

  return String(rawName)
    .replace(WHITESPACE_REGEX, ' ')
    .replace(MULTISPACE_REGEX, ' ')
    .trim();
}

export function validateRoomCode(code) {
  const sanitized = sanitizeName(code).toUpperCase();
  if (!sanitized) {
    return { valid: false, message: 'Room code cannot be empty.' };
  }

  if (!/^[A-Z0-9]{4,8}$/.test(sanitized)) {
    return {
      valid: false,
      message: 'Room codes must be 4-8 characters using letters or numbers.'
    };
  }

  return { valid: true, value: sanitized };
}
