const fs = require('fs');
const path = require('path');

const MARKERS = ['<<<<<<<', '=======', '>>>>>>>'];
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'public/uploads',
  'uploads',
  '.next',
]);
const IGNORED_FILES = new Set([
  path.join('scripts', 'check-conflict-markers.js'),
]);

const rootDir = path.join(__dirname, '..');
let hasConflicts = false;

/**
 * Determine whether a path should be ignored during scanning.
 * @param {string} filePath
 * @returns {boolean}
 */
function shouldIgnore(filePath) {
  const normalized = path.normalize(filePath);
  if (IGNORED_FILES.has(normalized)) {
    return true;
  }
  const segments = filePath.split(path.sep);
  return segments.some((segment) => IGNORED_DIRS.has(segment));
}

/**
 * Recursively scan a directory for conflict markers.
 * @param {string} dir
 */
function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (shouldIgnore(path.relative(rootDir, fullPath))) {
      continue;
    }

    if (entry.isDirectory()) {
      scanDirectory(fullPath);
    } else if (entry.isFile()) {
      inspectFile(fullPath);
    }
  }
}

/**
 * Inspect a single file for conflict markers.
 * @param {string} filePath
 */
function inspectFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    // Skip binary or unreadable files.
    return;
  }

  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (MARKERS.some((marker) => line.includes(marker))) {
      if (!hasConflicts) {
        console.error('Conflict markers found:');
        hasConflicts = true;
      }
      const relativePath = path.relative(rootDir, filePath);
      console.error(`  ${relativePath}:${index + 1} -> ${line.trim()}`);
    }
  });
}

scanDirectory(rootDir);

if (hasConflicts) {
  process.exitCode = 1;
} else {
  console.log('No conflict markers detected.');
}
