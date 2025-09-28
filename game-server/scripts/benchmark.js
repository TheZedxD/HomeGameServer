#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');
const { URL } = require('url');

const targetUrl = process.env.BENCHMARK_URL || 'http://localhost:3000/healthz';
const totalRequests = Number.parseInt(process.env.BENCHMARK_REQUESTS || '200', 10);
const concurrency = Number.parseInt(process.env.BENCHMARK_CONCURRENCY || '20', 10);

const url = new URL(targetUrl);
const client = url.protocol === 'https:' ? https : http;

function percentile(values, p) {
    if (!values.length) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[index];
}

function makeRequest() {
    return new Promise((resolve) => {
        const start = performance.now();
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            timeout: 5000,
        };
        const req = client.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', () => {
                const duration = performance.now() - start;
                resolve({ duration, statusCode: res.statusCode, ok: res.statusCode < 500 });
            });
        });
        req.on('error', (error) => {
            const duration = performance.now() - start;
            resolve({ duration, statusCode: 0, ok: false, error });
        });
        req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
        });
        req.end();
    });
}

async function runBenchmark() {
    const durations = [];
    let completed = 0;
    let failed = 0;
    const start = performance.now();

    async function worker() {
        while (completed + failed < totalRequests) {
            const result = await makeRequest();
            if (result.ok) {
                durations.push(result.duration);
                completed += 1;
            } else {
                failed += 1;
            }
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, totalRequests) }, () => worker());
    await Promise.all(workers);

    const totalDuration = performance.now() - start;
    const throughput = completed / (totalDuration / 1000);
    console.log('Benchmark results for', targetUrl);
    console.log(` - Total requests: ${totalRequests}`);
    console.log(` - Successful responses: ${completed}`);
    console.log(` - Failed responses: ${failed}`);
    console.log(` - Test duration: ${totalDuration.toFixed(2)} ms`);
    console.log(` - Throughput: ${throughput.toFixed(2)} req/s`);
    console.log(` - p50 latency: ${percentile(durations, 0.5).toFixed(2)} ms`);
    console.log(` - p95 latency: ${percentile(durations, 0.95).toFixed(2)} ms`);
    console.log(` - p99 latency: ${percentile(durations, 0.99).toFixed(2)} ms`);
}

runBenchmark().catch((error) => {
    console.error('Benchmark failed:', error);
    process.exit(1);
});
