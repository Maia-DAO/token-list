#!/usr/bin/env node
const fs = require('fs');

// ── Utilities ───────────────────────────────────────────────────────────────────

function mergeTokenData(existing, incoming) {
    const merged = {
        ...existing,
        ...incoming,
        name: existing.name,
        symbol: existing.symbol,
        isAcross: existing.isAcross || incoming.isAcross,
        isOFT: existing.isOFT || incoming.isOFT,
        logoURI: incoming.logoURI ?? existing.logoURI,
        extensions: mergeExtensions(existing.extensions, incoming.extensions)
    };

    return orderAttributes(merged);
}

// Function to order attributes consistently. 
function orderAttributes(token) {
    const ordered = {};
    const keysOrder = [
        "chainId",
        "address",
        "globalAddress",
        "localAddress",
        "underlyingAddress",
        "name",
        "symbol",
        "decimals",
        "logoURI",
        "tags",
        "extensions",
        "isAcross",
        "isOFT",
        "oftAdapter",
        "oftVersion",
        "endpointVersion",
        "endpointId",
        "oftSharedDecimals"
    ];

    keysOrder.forEach(key => {
        if (key in token) {
            ordered[key] = token[key];
        }
    });

    // Add any remaining keys that are not in the predefined order.
    Object.keys(token).forEach(key => {
        if (!ordered.hasOwnProperty(key)) {
            ordered[key] = token[key];
        }
    });

    return ordered;
}

function mergeExtensions(ext1 = {}, ext2 = {}) {
    const merged = { ...ext1 };
    for (const key in ext2) {
        if (merged[key] && typeof merged[key] === 'object' && typeof ext2[key] === 'object') {
            merged[key] = {
                ...merged[key],
                ...ext2[key]
            };
        } else {
            merged[key] = ext2[key];
        }
    }
    return merged;
}

// Count how “populated” a token is (number of non-null, non-empty fields)
function populationScore(t) {
    return Object.entries(t).reduce((sum, [k, v]) => {
        if (v !== null && v !== undefined && !(typeof v === "object" && Object.keys(v).length === 0)) {
            return sum + 1;
        }
        return sum;
    }, 0);
}

// ── Core Logic ────────────────────────────────────────────────────────────────

const INPUT = 'token-list.json';
const OUTPUT = 'token-list.json';

let data;
try {
    data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
} catch (err) {
    console.error(`❌ Failed to read/parse ${INPUT}:`, err.message);
    process.exit(1);
}

// Generic dedupe+merge for one array
function dedupeAndMerge(arr) {
    // bucket by key
    const buckets = new Map();
    arr.forEach(item => {
        const cid = item.chainId;
        const keys = [];
        if (item.address) keys.push(`${item.address.toLowerCase()}_${cid}`);
        if (item.underlyingAddress) keys.push(`${item.underlyingAddress.toLowerCase()}_${cid}`);
        // one item may appear in multiple buckets; we’ll merge inside each bucket
        keys.forEach(k => {
            if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k).push(item);
        });
    });

    // build final list, merging duplicates
    const seen = new Set();
    const result = [];

    buckets.forEach(group => {
        // pick the “merged” token for this key
        // sort by population ascending: least-populated first
        group.sort((a, b) => populationScore(a) - populationScore(b));
        let merged = group[0];
        for (let i = 1; i < group.length; i++) {
            merged = mergeTokenData(merged, group[i]);
        }

        const address = merged.address?.toLowerCase() ?? merged.underlyingAddress?.toLowerCase();

        // ensure we only push each merged token once
        const uniqueId = `${address}_${merged.chainId}`;
        if (!seen.has(uniqueId)) {
            result.push(merged);
            seen.add(uniqueId);
        }
    });

    // also include any tokens that never fell into a bucket
    arr.forEach(item => {
        const cid = item.chainId;
        const id = `${item.address?.toLowerCase() ?? item.underlyingAddress?.toLowerCase() ?? ''}_${cid}`;
        if (!seen.has(id)) {
            result.push(item);
            seen.add(id);
        }
    });

    return result;
}

// Process both lists
const mergedTokens = Array.isArray(data.tokens) ? dedupeAndMerge(data.tokens) : [];
const mergedRootTokens = Array.isArray(data.rootTokens) ? dedupeAndMerge(data.rootTokens) : [];

// Write out
const outData = {
    ...data,
    tokens: mergedTokens,
    rootTokens: mergedRootTokens
};

fs.writeFileSync(OUTPUT, JSON.stringify(outData, null, 2));
console.log(`✅ Duplicates merged. Output written to ${OUTPUT}`);
