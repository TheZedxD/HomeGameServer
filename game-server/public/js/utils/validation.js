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

export function validateForm(formData, rules) {
  const errors = [];

  Object.entries(rules || {}).forEach(([field, rule]) => {
    const rawValue = formData[field];
    const value = typeof rawValue === 'string' ? rawValue : rawValue ?? '';
    const hasValue = value !== '' && value !== null && value !== undefined;

    if (rule.required && !hasValue) {
      errors.push(`${rule.displayName} is required`);
      return;
    }
    if (!hasValue) {
      return;
    }
    if (rule.minLength && typeof value === 'string' && value.length < rule.minLength) {
      errors.push(`${rule.displayName} must be at least ${rule.minLength} characters`);
    }
    if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
      errors.push(rule.patternError || `${rule.displayName} format is invalid`);
    }
  });

  return errors;
}
