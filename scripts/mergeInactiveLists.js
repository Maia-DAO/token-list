// mergeUniswapLists.js
// Hardcoded input files array—no CLI args needed.

const fs = require('fs').promises;
const path = require('path');

async function main() {
    // 1. Uniswap format lists here:
    const inputFiles = [
        'output/uni_extended.json', 'output/compound.json', 'output/set.json', 'output/ba.json'
    ];

    // --- Step 1 & 2: Load and merge all input lists ---
    const mergedMap = new Map();

    for (const filePath of inputFiles) {
        let list;
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            list = JSON.parse(raw);
        } catch (err) {
            console.error(`❌  Failed to read or parse ${filePath}:`, err.message);
            continue;
        }

        // Extract the tokens array (Uniswap format)
        const tokens = Array.isArray(list.tokens)
            ? list.tokens
            : Array.isArray(list)
                ? list
                : [];

        for (const token of tokens) {
            const key = `${token.chainId}_${token.address.toLowerCase()}`;
            if (!mergedMap.has(key)) {
                mergedMap.set(key, { ...token }); // clone to avoid mutating original
            }
        }
    }

    const mergedTokens = Array.from(mergedMap.values());

    // --- Step 3: Enrich from existing token-list.json ---
    let existingList;
    try {
        const existingRaw = await fs.readFile(path.join('token-list.json'), 'utf8');
        existingList = JSON.parse(existingRaw);
    } catch (err) {
        console.error('❌  Could not read token-list.json:', err.message);
        process.exit(1);
    }

    const existingMap = new Map(
        (existingList.tokens || [])
          .filter(t => typeof t.address === 'string' && t.address.length > 0)
          .map(t => [
            `${t.chainId}_${t.address.toLowerCase()}`,
            t
          ])
      );      

    // Copy over extensions, isAcross, isOFT
    const finalTokens = mergedTokens.map(token => {
        const key = `${token.chainId}_${token.address.toLowerCase()}`;
        const existing = existingMap.get(key);
        if (existing) {
            return {
                ...token,
                extensions: existing.extensions,
                isAcross: existing.isAcross,
                isOFT: existing.isOFT
            };
        } else {
            return {
                ...token,
                extensions: token.extensions || {},
                isAcross: false,
                isOFT: false
            };
        }
    });

    // --- Write out the combined list ---
    const output = {
        name: existingList.name || 'Hermes Omnichain Inactive Token List',
        timestamp: new Date().toISOString(),
        version: { ...existingList.version },
        tokens: finalTokens,
        keywords: existingList.keywords || [],
        tags: existingList.tags || {},
        logoURI: existingList.logoURI || ''
    };

    try {
        await fs.writeFile('inactive-token-list.json', JSON.stringify(output, null, 2));
        console.log(`✅  inactive-token-list.json written with ${finalTokens.length} tokens`);
    } catch (err) {
        console.error('❌  Failed to write merged-full.json:', err.message);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
