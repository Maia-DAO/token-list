const fs = require('fs').promises;
const path = require('path');

// ---------------------------------------------------------------------
// Normalization functions for tokens to the unified format
// ---------------------------------------------------------------------

/**
 * Normalize a token from the across list.
 * Input structure (from TOKEN_SYMBOLS_MAP):
 * {
 *    name: string,
 *    symbol: string,
 *    decimals: number,
 *    addresses: { [chainId: string]: string },
 *    coingeckoId: string,
 *    logoURI?: string
 * }
 *
 * Each address entry from across is converted to a separate token.
 */
function normalizeAcrossToken(symbol, data) {
    const tokens = [];
    // Convert addresses keys to numbers.
    for (const key in data.addresses) {
        const chainId = Number(key);
        const address = data.addresses[key];
        tokens.push({
            // New unified token format.
            chainId,
            address,          // use the chain-specific address as "address"
            name: data.name,
            decimals: data.decimals,
            symbol: data.symbol,
            logoURI: data.logoURI || null,
            tags: [],
            extensions: { coingeckoId: data.coingeckoId },
            isAcross: true,   // from across list
            isOFT: false
        });
    }
    return tokens;
}

/**
 * Normalize a token from the filtered stargate tokens list.
 * Expected fields:
 * {
 *   chainKey: string,  // e.g. "aptos" (but we use a default numeric chainId)
 *   address: string,
 *   decimals: number,
 *   symbol: string,
 *   name: string,
 *   icon: string,
 *   extensions?: { ... }
 * }
 *
 * Produces one token entry in the new unified format.
 */
function normalizeStargateToken(token) {
    return [{
        chainId: 1, // default numeric chainId (adjust if needed)
        address: token.address,
        name: token.name,
        decimals: token.decimals,
        symbol: token.symbol,
        logoURI: token.icon || null,
        tags: [],
        extensions: token.extensions ? { bridgeInfo: token.extensions.bridgeInfo } : {},
        isAcross: false,
        isOFT: true  // from stargate list
    }];
}

// ---------------------------------------------------------------------
// Ulysses tokens and Uniswap tokens are added as-is (Format B).
// Ulysses tokens are used directly.
// Uniswap tokens are also added as-is except those with chainId === 42161;
// those go to rootTokens (overwriting any duplicate by symbol).
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Merge helper for normalized (Format A) tokens
// ---------------------------------------------------------------------
/**
 * Merges a token into the merged mapping.
 * In this version each token is uniquely keyed by symbol (uppercased) and chainId.
 */
function addOrMergeNormalizedToken(mergedMap, token) {
    const key = token.symbol.toUpperCase() + "_" + token.chainId;
    if (!mergedMap[key]) {
        mergedMap[key] = token;
    } else {
        const existing = mergedMap[key];
        // Merge flags if either token flags it.
        if (token.isAcross) existing.isAcross = true;
        if (token.isOFT) existing.isOFT = true;
        // Merge local fields if needed.
        if (!existing.logoURI && token.logoURI) {
            existing.logoURI = token.logoURI;
        }
        // Additional merging logic can be added as necessary.
    }
}

/**
 * Bumps version by incrementing the patch version.
 */
function bumpVersion(oldVersion) {
    return {
        major: oldVersion.major + 1,
        minor: oldVersion.minor,
        patch: oldVersion.patch
    };
}

/**
 * Compare two objects by stringifying them.
 * We assume the order of keys and arrays is consistent.
 */
function isEqual(obj1, obj2) {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
}

/**
 * Main merge function.
 */
async function mergeTokens() {
    try {
        // Read source files from the output directory.
        // 1. Across tokens from filteredAcrossTokens.json 
        const acrossDataRaw = await fs.readFile(path.join('output', 'filteredAcrossTokens.json'), 'utf8');
        const acrossData = JSON.parse(acrossDataRaw);

        // 2. Filtered stargate tokens from filteredStargateTokens.json 
        const stargateRaw = await fs.readFile(path.join('output', 'filteredStargateTokens.json'), 'utf8');
        const stargateTokens = JSON.parse(stargateRaw);

        // 3. Ulysses tokens from ulysses.json
        const ulyssesRaw = await fs.readFile(path.join('output', 'ulysses.json'), 'utf8');
        const ulyssesData = JSON.parse(ulyssesRaw);

        // 4. Uniswap tokens from uniswap.json.
        const uniswapRaw = await fs.readFile(path.join('output', 'uniswap.json'), 'utf8');
        let uniswapTokens = [];
        try {
            const temp = JSON.parse(uniswapRaw);
            if (Array.isArray(temp.tokens)) {
                uniswapTokens = temp.tokens;
            } else if (Array.isArray(temp)) {
                uniswapTokens = temp;
            }
        } catch (err) {
            console.error('Error parsing uniswap.json, assuming direct array:', err);
        }

        // -----------------------------------------------------------------
        // GROUPING TOKENS PER SOURCE
        // -----------------------------------------------------------------

        // 1. Build the normalized map from Across and Stargate tokens.
        const normalizedMap = {};
        const rootTokensMap = {};

        // Process Across tokens.
        for (const symbol in acrossData) {
            const tokenData = acrossData[symbol];
            const normalizedArray = normalizeAcrossToken(symbol, tokenData);
            normalizedArray.forEach(token => {
                if (token.chainId === 42161) {
                    // Merge into rootTokensMap.
                    const rootKey = token.symbol.toUpperCase();
                    if (!rootTokensMap[rootKey]) {
                        rootTokensMap[rootKey] = token;
                    } else {
                        const existing = rootTokensMap[rootKey];
                        if (token.isAcross) existing.isAcross = true;
                        if (!existing.logoURI && token.logoURI) {
                            existing.logoURI = token.logoURI;
                        }
                    }
                } else {
                    // Merge into normalizedMap.
                    const key = token.symbol.toUpperCase() + "_" + token.chainId;
                    if (!normalizedMap[key]) {
                        normalizedMap[key] = token;
                    } else {
                        const existing = normalizedMap[key];
                        if (token.isAcross) existing.isAcross = true;
                        if (!existing.logoURI && token.logoURI) {
                            existing.logoURI = token.logoURI;
                        }
                    }
                }
            });
        }

        // Process Stargate tokens.
        stargateTokens.forEach(token => {
            const normalizedArray = normalizeStargateToken(token);
            normalizedArray.forEach(token => {
                if (token.chainId === 42161) {
                    const rootKey = token.symbol.toUpperCase();
                    if (!rootTokensMap[rootKey]) {
                        rootTokensMap[rootKey] = token;
                    } else {
                        const existing = rootTokensMap[rootKey];
                        if (token.isOFT) existing.isOFT = true;
                        if (!existing.logoURI && token.logoURI) {
                            existing.logoURI = token.logoURI;
                        }
                    }
                } else {
                    const key = token.symbol.toUpperCase() + "_" + token.chainId;
                    if (!normalizedMap[key]) {
                        normalizedMap[key] = token;
                    } else {
                        const existing = normalizedMap[key];
                        if (token.isOFT) existing.isOFT = true;
                        if (!existing.logoURI && token.logoURI) {
                            existing.logoURI = token.logoURI;
                        }
                    }
                }
            });
        });

        // 2. Incorporate Ulysses tokens (Format B).
        if (ulyssesData.tokens && Array.isArray(ulyssesData.tokens)) {
            ulyssesData.tokens.forEach(token => {
                if (token.chainId === 42161) {
                    const rootKey = token.symbol.toUpperCase();
                    if (rootTokensMap[rootKey]) {
                        const existing = rootTokensMap[rootKey];
                        if (token.isAcross) existing.isAcross = true;
                        if (token.isOFT) existing.isOFT = true;
                        if (!existing.logoURI && token.logoURI) {
                            existing.logoURI = token.logoURI;
                        }
                        // Add additional field merging as needed.
                    } else {
                        rootTokensMap[token.symbol.toUpperCase()] = token;
                    }
                } else {
                    const key = token.symbol.toUpperCase() + "_" + token.chainId;
                    if (normalizedMap[key]) {
                        const existing = normalizedMap[key];
                        if (token.isAcross) existing.isAcross = true;
                        if (token.isOFT) existing.isOFT = true;
                        if (!existing.logoURI && token.logoURI) {
                            existing.logoURI = token.logoURI;
                        }
                    } else {
                        normalizedMap[key] = token;
                    }
                }
            });
        }

        // 3. Incorporate Uniswap tokens (Format B).
        if (Array.isArray(uniswapTokens)) {
            uniswapTokens.forEach(token => {
                // Default flags if undefined.
                if (typeof token.isAcross === 'undefined') token.isAcross = false;
                if (typeof token.isOFT === 'undefined') token.isOFT = false;
                if (token.chainId === 42161) {
                    const rootKey = token.symbol.toUpperCase();
                    if (rootTokensMap[rootKey]) {
                        const existing = rootTokensMap[rootKey];
                        if (token.isAcross) existing.isAcross = true;
                        if (token.isOFT) existing.isOFT = true;
                        if (!existing.logoURI && token.logoURI) {
                            existing.logoURI = token.logoURI;
                        }
                    } else {
                        rootTokensMap[rootKey] = token;
                    }
                } else {
                    const key = token.symbol.toUpperCase() + "_" + token.chainId;
                    if (normalizedMap[key]) {
                        const existing = normalizedMap[key];
                        if (token.isAcross) existing.isAcross = true;
                        if (token.isOFT) existing.isOFT = true;
                        if (!existing.logoURI && token.logoURI) {
                            existing.logoURI = token.logoURI;
                        }
                    } else {
                        normalizedMap[key] = token;
                    }
                }
            });
        }

        // 4. Final tokens and rootTokens arrays.
        const finalTokens = Object.values(normalizedMap);
        const finalRootTokens = Object.values(rootTokensMap);

        // -----------------------------------------------------------------
        // Build new merged output in complete token list format.
        // -----------------------------------------------------------------
        const newOutput = {
            name: "Hermes Omnichain Token List",
            timestamp: new Date().toISOString(),
            version: { major: 1, minor: 0, patch: 0 }, // default version if no previous exists
            tokens: finalTokens,
            rootTokens: finalRootTokens,
            tags: {},
            keywords: ["hermes", "default"],
            logoURI: "https://raw.githubusercontent.com/Maia-DAO/token-list-v2/main/logos/Hermes-color.svg"
        };

        // Read previous file if it exists to check for differences.
        let finalOutput = newOutput;
        try {
            const existingDataRaw = await fs.readFile('token-list.json', 'utf8');
            const existingData = JSON.parse(existingDataRaw);
            // Remove version and timestamp from both outputs for comparison.
            const oldComparable = { ...existingData, version: undefined, timestamp: undefined };
            const newComparable = { ...newOutput, version: undefined, timestamp: undefined };
            if (!isEqual(oldComparable, newComparable)) {
                // If differences exist, bump patch version.
                finalOutput.version = bumpVersion(existingData.version);
                finalOutput.timestamp = new Date().toISOString()
            } else {
                // No meaningful changes; keep previous version.
                finalOutput.version = existingData.version;
            }
        } catch (err) {
            // File doesn't exist; we'll use the default version.
        }

        // Write final merged output to token-list.json.
        await fs.writeFile('token-list.json', JSON.stringify(finalOutput, null, 2));
        console.log('Merged Token List saved to token-list.json');
    } catch (error) {
        console.error('Error merging tokens:', error);
    }
}

mergeTokens();
