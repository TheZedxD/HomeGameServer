'use strict';

const fs = require('fs');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lock(filePath, options = {}) {
  const lockPath = `${filePath}.lock`;
  const retries = options.retries?.retries ?? 0;
  const minTimeout = options.retries?.minTimeout ?? 50;
  let attempt = 0;

  while (true) {
    try {
      const handle = await fs.promises.open(lockPath, 'wx');
      await handle.close();

      let released = false;
      return async () => {
        if (released) {
          return;
        }
        released = true;
        await fs.promises.unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt >= retries) {
        throw error;
      }
      attempt += 1;
      await delay(minTimeout);
    }
  }
}

async function check(filePath) {
  try {
    await fs.promises.access(`${filePath}.lock`, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  lock,
  check,
};
