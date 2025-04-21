const fs = require('fs').promises;
const path = require('path');
const { getCoinLogo } = require('./getCoinLogo')

// ---------------------------------------------------------------------
// Normalization functions for tokens to the unified format
// ---------------------------------------------------------------------

function mergeTokenData(existing, incoming, isUlysses = false) {
    // We use Ulysses format if the token is from Ulysses.
    if (isUlysses) {
        const { address: addressIncoming, ...restIncoming } = existing
        const { address: addressExisting, ...restExisting } = incoming

        return {
            ...restIncoming,
            ...restExisting,
            name: incoming.name,
            symbol: incoming.symbol,
            isAcross: existing.isAcross || incoming.isAcross,
            isOFT: existing.isOFT || incoming.isOFT,
            logoURI: incoming.logoURI || existing.logoURI,
            extensions: mergeExtensions(existing.extensions, incoming.extensions)
        }
    }

    return {
        ...existing,
        ...incoming,
        name: incoming.name,
        symbol: incoming.symbol,
        isAcross: existing.isAcross || incoming.isAcross,
        isOFT: existing.isOFT || incoming.isOFT,
        logoURI: incoming.logoURI || existing.logoURI,
        extensions: mergeExtensions(existing.extensions, incoming.extensions)
    };
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
async function normalizeAcrossToken(data) {
    const tokens = [];
    // Convert addresses keys to numbers.
    for (const key in data.addresses) {
        const chainId = Number(key);
        const address = data.addresses[key];
        tokens.push({
            chainId,
            address,
            name: data.name,
            decimals: data.decimals,
            symbol: data.symbol,
            logoURI: await getCoinLogo(data.coingeckoId) || null,
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
        chainId: token.chainId,
        address: token.address,
        name: token.name,
        decimals: token.decimals,
        symbol: token.symbol,
        logoURI: token.icon || null,
        tags: [],
        extensions: token.extensions ? token.extensions : {},
        isAcross: false,
        isOFT: true  // from stargate list
    }];
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
async function main() {
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
            const normalizedArray = await normalizeAcrossToken(tokenData);
            normalizedArray.forEach(token => {
                if (!token.logoURI) return
                if (token.chainId === 42161) {
                    // Merge into rootTokensMap.
                    const rootKey = token.symbol.toUpperCase();
                    if (!rootTokensMap[rootKey]) {
                        rootTokensMap[rootKey] = token;
                    } else {
                        const existing = rootTokensMap[rootKey];
                        rootTokensMap[rootKey] = mergeTokenData(existing, token);
                    }
                } else {
                    // Merge into normalizedMap.
                    const key = token.symbol.toUpperCase() + "_" + token.chainId;
                    if (!normalizedMap[key]) {
                        normalizedMap[key] = token;
                    } else {
                        normalizedMap[key] = mergeTokenData(normalizedMap[key], token);
                    }
                }
            });
        }

        // Process Stargate tokens.
        stargateTokens.forEach(token => {
            const normalizedArray = normalizeStargateToken(token);
            normalizedArray.forEach(token => {
                if (!token.logoURI) return
                if (token.chainId === 42161) {
                    const rootKey = token.symbol.toUpperCase();
                    if (!rootTokensMap[rootKey]) {
                        rootTokensMap[rootKey] = token;
                    } else {
                        rootTokensMap[rootKey] = mergeTokenData(rootTokensMap[rootKey], token);
                    }
                } else {
                    const key = token.symbol.toUpperCase() + "_" + token.chainId;
                    if (!normalizedMap[key]) {
                        normalizedMap[key] = token;
                    } else {
                        normalizedMap[key] = mergeTokenData(normalizedMap[key], token);
                    }
                }
            });
        });


        // 2. Incorporate Uniswap tokens (Format B).
        if (Array.isArray(uniswapTokens)) {
            uniswapTokens.forEach(token => {
                if (!token.logoURI) return
                // Default flags if undefined.
                if (typeof token.isAcross === 'undefined') token.isAcross = false;
                if (typeof token.isOFT === 'undefined') token.isOFT = false;
                if (token.chainId === 42161) {
                    const rootKey = token.symbol.toUpperCase();
                    if (rootTokensMap[rootKey]) {
                        const existing = rootTokensMap[rootKey];
                        rootTokensMap[rootKey] = mergeTokenData(existing, token);
                    } else {
                        rootTokensMap[rootKey] = token;
                    }
                } else {
                    const key = token.symbol.toUpperCase() + "_" + token.chainId;
                    if (normalizedMap[key]) {
                        const existing = normalizedMap[key];
                        normalizedMap[key] = mergeTokenData(existing, token);
                    } else {
                        normalizedMap[key] = token;
                    }
                }
            });
        }

        // 3. Incorporate Ulysses tokens (Format B).
        if (ulyssesData.tokens && Array.isArray(ulyssesData.tokens)) {
            ulyssesData.tokens.forEach(token => {
                if (!token.logoURI) return
                    const key = token.symbol.toUpperCase() + "_" + token.chainId;
                    if (normalizedMap[key]) {
                        const existing = normalizedMap[key];
                        normalizedMap[key] = mergeTokenData(existing, token, true);
                    } else {
                        normalizedMap[key] = token;
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
            timestamp: (Math.floor(Date.now() / 1000)).toString(),
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
                finalOutput.timestamp = (Math.floor(Date.now() / 1000)).toString();
            } else {
                // No meaningful changes; keep previous version.
                finalOutput.version = existingData.version;
                finalOutput.timestamp = existingData.timestamp;
            }
        } catch (err) {
            // File doesn't exist; we'll use the default version.
        }

        // Write final merged output to token-list.json.
        await fs.writeFile('token-list.json', JSON.stringify(finalOutput, null, 2));
        console.log(`✅  token-list.json written with ${finalTokens.length} tokens and ${finalRootTokens.length} root tokens`);
    } catch (error) {
        console.error('❌ Error merging tokens:', error);
    }
}

main();
