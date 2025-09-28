#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

function runCommand(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        stdio: 'inherit',
        env: process.env,
        ...options,
    });
    return result.status === null ? 1 : result.status;
}

function runAudit() {
    const result = spawnSync('npm', ['audit', '--json'], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: process.env,
    });
    if (result.error) {
        console.warn('npm audit failed to run:', result.error.message);
        return { status: 1, findings: [] };
    }
    let report;
    try {
        report = JSON.parse(result.stdout || '{}');
    } catch (error) {
        console.warn('Unable to parse npm audit output:', error.message);
        return { status: 1, findings: [] };
    }
    const findings = Object.values(report.vulnerabilities || {}).filter((item) => item.severity === 'high' || item.severity === 'critical');
    if (findings.length) {
        console.error('High severity vulnerabilities detected:');
        for (const finding of findings) {
            console.error(` - ${finding.name}@${finding.range} (${finding.severity})`);
        }
    }
    return { status: findings.length ? 1 : 0, findings };
}

function main() {
    console.log('Running security lint...');
    const lintStatus = runCommand('node', ['scripts/security-lint.js']);
    if (lintStatus !== 0) {
        process.exit(lintStatus);
    }

    console.log('Running dependency vulnerability audit...');
    const auditResult = runAudit();
    if (auditResult.status !== 0) {
        console.error('Security scan failed due to dependency vulnerabilities.');
        process.exit(1);
    }

    console.log('Security scan completed successfully.');
}

main();
