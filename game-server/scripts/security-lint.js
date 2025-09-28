#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

const args = process.argv.slice(2);
const wantsEslintOnly = args.includes('--eslint-only');
const wantsAuditOnly = args.includes('--audit-only');
const wantsEslint = wantsAuditOnly ? false : (wantsEslintOnly || !args.length || args.includes('--eslint'));
const wantsAudit = wantsEslintOnly ? false : (wantsAuditOnly || !args.length || args.includes('--audit'));

function getCommandName(bin) {
  return process.platform === 'win32' ? `${bin}.cmd` : bin;
}

function hasEslintConfig() {
  const configFiles = [
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yaml',
    '.eslintrc.yml'
  ];
  return (
    configFiles.some((file) => fs.existsSync(path.join(projectRoot, file))) ||
    (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
        return Boolean(pkg.eslintConfig);
      } catch (error) {
        return false;
      }
    })()
  );
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || projectRoot,
      stdio: options.stdio || 'inherit'
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        const err = new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`);
        err.code = code;
        reject(err);
      }
    });
  });
}

function runCommandWithOutput(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || projectRoot,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runEslint() {
  if (!hasEslintConfig()) {
    console.log('⚪ Skipping ESLint: no configuration file found.');
    return 0;
  }

  console.log('🔍 Running ESLint...');
  try {
    await runCommand(getCommandName('npx'), ['eslint', '.']);
    return 0;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('ESLint is not installed. Add it to your devDependencies to enable linting.');
      return 1;
    }
    console.error(error.message || error);
    return typeof error.code === 'number' ? error.code : 1;
  }
}

function parseAuditOutput(raw) {
  try {
    const data = JSON.parse(raw);
    if (data && data.metadata && data.metadata.vulnerabilities) {
      const { high = 0, critical = 0 } = data.metadata.vulnerabilities;
      return { high, critical };
    }
    if (data && data.vulnerabilities) {
      const severity = { high: 0, critical: 0 };
      for (const item of Object.values(data.vulnerabilities)) {
        if (item.severity === 'high') severity.high += 1;
        if (item.severity === 'critical') severity.critical += 1;
      }
      return severity;
    }
    return { high: 0, critical: 0 };
  } catch (error) {
    console.warn('Unable to parse npm audit output as JSON. Raw output will be shown below.');
    console.warn(raw);
    return { high: 0, critical: 0, parseError: true };
  }
}

async function runAudit() {
  console.log('🔐 Running npm audit --production...');
  const result = await runCommandWithOutput(getCommandName('npm'), ['audit', '--production', '--json']);

  if (!result.stdout.trim()) {
    if (result.code !== 0) {
      console.error('npm audit failed without output. Exit code:', result.code);
      return result.code || 1;
    }
    console.log('npm audit completed with no output.');
    return 0;
  }

  const summary = parseAuditOutput(result.stdout);
  if (summary.high > 0 || summary.critical > 0) {
    console.error(`Security vulnerabilities detected: high=${summary.high}, critical=${summary.critical}`);
    return 1;
  }

  if (result.code !== 0) {
    console.warn('npm audit exited with a non-zero code but no high/critical vulnerabilities were reported.');
    console.warn(result.stdout);
    if (result.stderr) {
      console.warn(result.stderr);
    }
    return 0;
  }

  console.log('npm audit completed with no high or critical vulnerabilities.');
  return 0;
}

(async () => {
  let exitCode = 0;

  if (wantsEslint) {
    const eslintExit = await runEslint();
    if (eslintExit !== 0) {
      exitCode = eslintExit;
    }
  }

  if (wantsAudit) {
    try {
      const auditExit = await runAudit();
      if (auditExit !== 0 && exitCode === 0) {
        exitCode = auditExit;
      }
    } catch (error) {
      console.error('npm audit failed to run:', error.message || error);
      if (typeof error.code === 'number') {
        exitCode = error.code;
      } else if (exitCode === 0) {
        exitCode = 1;
      }
    }
  }

  process.exit(exitCode);
})().catch((error) => {
  console.error('security-lint.js failed:', error);
  process.exit(1);
});
