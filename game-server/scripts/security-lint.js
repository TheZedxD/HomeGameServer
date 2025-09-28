#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const configPath = path.join(projectRoot, 'config', 'security-rules.json');

function loadConfig() {
    const defaultConfig = {
        include: ['server.js', 'src', 'lib', 'tests'],
        exclude: ['node_modules', '.git'],
        rules: [],
    };
    try {
        const file = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(file);
        return { ...defaultConfig, ...parsed };
    } catch (error) {
        console.warn('Security lint config missing, using defaults.');
        return defaultConfig;
    }
}

function walkFiles(targetPath, exclude) {
    const absolutePath = path.join(projectRoot, targetPath);
    const results = [];
    if (!fs.existsSync(absolutePath)) {
        return results;
    }
    const stats = fs.statSync(absolutePath);
    if (stats.isFile()) {
        results.push(absolutePath);
        return results;
    }
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(targetPath, entry.name);
        if (exclude.some((ex) => entryPath.startsWith(ex))) {
            continue;
        }
        const fullPath = path.join(projectRoot, entryPath);
        if (entry.isDirectory()) {
            results.push(...walkFiles(entryPath, exclude));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            results.push(fullPath);
        }
    }
    return results;
}

function analyzeFile(filePath, rules) {
    const content = fs.readFileSync(filePath, 'utf8');
    const findings = [];
    for (const rule of rules) {
        const regex = new RegExp(rule.pattern, 'g');
        let match = regex.exec(content);
        while (match) {
            const before = content.slice(0, match.index);
            const lineNumber = before.split(/\n/).length;
            findings.push({
                rule,
                line: lineNumber,
                excerpt: content.split(/\n/)[lineNumber - 1]?.trim() || '',
            });
            match = regex.exec(content);
        }
    }
    return findings;
}

function main() {
    const config = loadConfig();
    const files = config.include.flatMap((target) => walkFiles(target, config.exclude || []));
    const summary = [];
    let errorCount = 0;
    let warningCount = 0;

    for (const file of files) {
        const findings = analyzeFile(file, config.rules);
        if (!findings.length) {
            continue;
        }
        for (const finding of findings) {
            const relativePath = path.relative(projectRoot, file);
            const severity = finding.rule.severity || 'warning';
            const message = `${severity.toUpperCase()}: [${finding.rule.id}] ${finding.rule.description}`;
            summary.push({
                severity,
                file: relativePath,
                line: finding.line,
                message,
                excerpt: finding.excerpt,
            });
            if (severity === 'error') {
                errorCount += 1;
            } else {
                warningCount += 1;
            }
        }
    }

    if (!summary.length) {
        console.log('✔ Security lint passed with no findings.');
        process.exit(0);
    }

    console.log('Security lint findings:');
    for (const item of summary) {
        console.log(` - ${item.severity.toUpperCase()} ${item.file}:${item.line} ${item.message}`);
        if (item.excerpt) {
            console.log(`     > ${item.excerpt}`);
        }
    }
    console.log(`Summary: ${errorCount} errors, ${warningCount} warnings.`);

    if (errorCount > 0) {
        process.exit(1);
    }
}

main();
