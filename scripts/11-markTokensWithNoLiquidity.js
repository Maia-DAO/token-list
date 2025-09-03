const fs = require('fs').promises;
const path = require('path');
const { ZERO_ADDRESS } = require('maia-core-sdk');

const { CHAIN_KEYS, PARTNER_TOKEN_SYMBOLS } = require('../configs');

const MINIMUM_LIQUIDITY = 10_000;
const BATCH_SIZE = 5;
const REQUEST_DELAY = 1000;

// TODO: use or delete unused analytics data
class TokenLiquidityChecker {

    constructor(options = {}) {
        // File paths (following your script structure)
        this.tokenListPath = options.tokenListPath || path.resolve(__dirname, '../token-list.json');
        this.inactiveTokenListPath = options.inactiveTokenListPath || path.resolve(__dirname, '../inactive-token-list.json');
        this.backupSuffix = options.backupSuffix || '.bak';

        // Rate limiting
        this.lastRequestTime = 0;
        this.minRequestInterval = 200; // 200ms between requests

        // Known API mappings based on search results and documentation
        this.chainMappings = {
            dexscreener: {
                // Confirmed supported chains from search results
                1: 'ethereum',
                42161: 'arbitrum',
                8453: 'base',
                56: 'bsc',
                80094: 'berachain',
                10: 'optimism',
                1088: 'metis',
                43114: 'avalanche',
                146: 'sonic',
                137: 'polygon',
                252: 'fraxtal',
                57073: 'ink',
                1116: 'core',
                534352: 'scroll',
                33139: 'apechain',
                42220: 'celo',
                1329: 'seiv2',
                4200: 'merlinchain',
                480: 'worldchain',
                747474: 'katana',
                42170: 'arbitrumnova',
                1313161554: 'aurora',
                130: 'unichain',
                999: 'hyperevm',
                7777777: 'zora',
                204: 'opbnb',
                169: 'manta',
                100: 'gnosischain',
                59144: 'linea',
                122: 'fuse',
                1868: 'soneium',
                1030: 'conflux',
                1514: 'story',
                167000: 'taiko',
                6001: 'bouncebit',
                14: 'flare',
                34443: 'mode',
                81457: 'blast',
                5000: 'mantle',
            },
            geckoterminal: {
                // GeckoTerminal network identifiers (different from DEXScreener)
                1: 'eth',
                42161: 'arbitrum',
                1088: 'metis',
                8453: 'base',
                137: 'polygon_pos',
                10: 'optimism',
                56: 'bsc',
                43114: 'avax',
                1116: 'core',
                534352: 'scroll',
                42220: 'celo',
                50: 'xdc',
                42170: 'arbitrum_nova',
                1890: 'lightlink-phoenix',
                1313161554: 'aurora',
                204: 'opbnb',
                169: 'manta-pacific',
                100: 'xdai',
                59144: 'linea',
                122: 'fuse',
                14: 'flare',
                34443: 'mode',
                5000: 'mantle',
            }
        };
    }

    /**
     * Rate limiting helper
     */
    async rateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestInterval) {
            await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
    }

    /**
     * File I/O methods (following your script pattern)
     */
    async readJson(filePath) {
        const txt = await fs.readFile(filePath, 'utf8');
        return JSON.parse(txt);
    }

    async writeJson(filePath, obj) {
        await fs.writeFile(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    }

    /**
     * Load token lists from your JSON files
     */
    async loadTokenLists() {
        console.log('Loading token lists...');
        const [tokenList, inactiveTokenList] = await Promise.all([
            this.readJson(this.tokenListPath),
            this.readJson(this.inactiveTokenListPath)
        ]);

        return { tokenList, inactiveTokenList };
    }

    /**
     * Extract all tokens from token lists (tokens, rootTokens, inactive tokens)
     */
    extractAllTokens(tokenList, inactiveTokenList) {
        const allTokens = [];

        // Add tokens from main token list
        if (tokenList.tokens) {
            allTokens.push(...tokenList.tokens.map(token => ({
                ...token,
                source: 'tokens'
            })));
        }

        // Add root tokens
        if (tokenList.rootTokens) {
            allTokens.push(...tokenList.rootTokens.map(token => ({
                ...token,
                source: 'rootTokens'
            })));
        }

        // Add inactive tokens
        if (inactiveTokenList.tokens) {
            allTokens.push(...inactiveTokenList.tokens.map(token => ({
                ...token,
                source: 'inactive'
            })));
        }

        return allTokens;
    }

    /**
     * Get token address, checking both address and extensions for multi-chain tokens
     */
    getTokenAddress(tokenObject) {
        // First check direct address
        if (tokenObject.address) {
            return tokenObject.address;
        }

        // Check if there's an underlyingAddress
        if (tokenObject.underlyingAddress) {
            return tokenObject.underlyingAddress;
        }

        return null;
    }

    /**
     * Get all peer addresses for an OFT token
     */
    collectOFTPeerAddresses(token) {
        const peers = [];
        try {
            const peersInfo = token?.extensions?.oftInfo?.peersInfo;
            if (!peersInfo) return peers;

            for (const chainId of Object.keys(peersInfo)) {
                const addr = peersInfo[chainId]?.tokenAddress;
                if (addr && addr !== ZERO_ADDRESS) {
                    peers.push({
                        chainId: parseInt(chainId),
                        address: addr,
                        chainName: CHAIN_KEYS[parseInt(chainId)] || chainId
                    });
                }
            }
        } catch (e) {
            // Ignore parsing errors
        }
        return peers;
    }

    /**
     * Get all peer addresses for an Across token
     */
    collectAcrossPeerAddresses(token) {
        const peers = [];
        try {
            const acrossInfo = token?.extensions?.acrossInfo;
            if (!acrossInfo) return peers;

            for (const chainId of Object.keys(acrossInfo)) {
                const addr = acrossInfo[chainId]?.address;
                if (addr && addr !== ZERO_ADDRESS) {
                    peers.push({
                        chainId: parseInt(chainId),
                        address: addr,
                        chainName: CHAIN_KEYS[parseInt(chainId)] || chainId
                    });
                }
            }
        } catch (e) {
            // Ignore parsing errors
        }
        return peers;
    }

    /**
     * Get all peer addresses for a token (handles both OFT and Across)
     */
    collectAllPeerAddresses(token) {
        const oftPeers = this.collectOFTPeerAddresses(token);
        const acrossPeers = this.collectAcrossPeerAddresses(token);
        return [...oftPeers, ...acrossPeers];
    }

    /**
     * Check if chain is supported by a specific API
     */
    isChainSupported(chainId, apiName = 'dexscreener') {
        return this.chainMappings[apiName] && this.chainMappings[apiName][chainId];
    }

    /**
     * Get all supported chains for debugging
     */
    getSupportedChains() {
        const dexScreenerChains = Object.keys(this.chainMappings.dexscreener).map(Number);
        const geckoTerminalChains = Object.keys(this.chainMappings.geckoterminal).map(Number);
        const allSupportedChains = [...new Set([...dexScreenerChains, ...geckoTerminalChains])];
        const unsupportedChains = Object.keys(CHAIN_KEYS)
            .map(Number)
            .filter(chainId => !allSupportedChains.includes(chainId));

        return {
            dexScreener: dexScreenerChains.length,
            geckoTerminal: geckoTerminalChains.length,
            totalSupported: allSupportedChains.length,
            totalChains: Object.keys(CHAIN_KEYS).length,
            unsupportedChains: unsupportedChains
        };
    }

    /**
     * Check liquidity using DEXScreener API
     */
    async checkLiquidityDEXScreener(chainId, tokenAddress) {
        try {
            await this.rateLimit();

            const chainName = this.chainMappings.dexscreener[chainId];
            if (!chainName) {
                const chainKey = CHAIN_KEYS[chainId];
                return {
                    success: false,
                    error: `Chain ${chainKey || chainId} not supported by DEXScreener`,
                    chainSupported: false
                };
            }

            const url = `https://api.dexscreener.com/tokens/v1/${chainName}/${tokenAddress}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data || data.length === 0) {
                return {
                    success: true,
                    hasLiquidity: false,
                    totalLiquidity: 0,
                    pairsCount: 0,
                    chainSupported: true,
                    source: 'dexscreener'
                };
            }

            // Calculate total liquidity
            const totalLiquidity = data.reduce((sum, pair) => {
                return sum + (parseFloat(pair.liquidity?.usd) || 0);
            }, 0);

            return {
                success: true,
                hasLiquidity: totalLiquidity > 0,
                totalLiquidity: totalLiquidity,
                pairsCount: data.length,
                chainSupported: true,
                source: 'dexscreener'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                chainSupported: this.isChainSupported(chainId, 'dexscreener'),
                source: 'dexscreener'
            };
        }
    }

    /**
     * Check liquidity using GeckoTerminal API (backup)
     */
    async checkLiquidityGeckoTerminal(chainId, tokenAddress) {
        try {
            await this.rateLimit();

            const networkName = this.chainMappings.geckoterminal[chainId];
            if (!networkName) {
                const chainKey = CHAIN_KEYS[chainId];
                return {
                    success: false,
                    error: `Chain ${chainKey || chainId} not supported by GeckoTerminal`,
                    chainSupported: false
                };
            }

            const url = `https://api.geckoterminal.com/api/v2/search/pools?query=${tokenAddress}&network=${networkName}&page=1`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.data || data.data.length === 0) {
                return {
                    success: true,
                    hasLiquidity: false,
                    totalLiquidity: 0,
                    pairsCount: 0,
                    chainSupported: true,
                    source: 'geckoterminal'
                };
            }

            // Calculate total liquidity from pools
            const totalLiquidity = data.data.reduce((sum, pool) => {
                const liquidityUsd = parseFloat(pool.attributes?.reserve_in_usd) || 0;
                return sum + liquidityUsd;
            }, 0);

            return {
                success: true,
                hasLiquidity: totalLiquidity > 0,
                totalLiquidity: totalLiquidity,
                pairsCount: data.data.length,
                chainSupported: true,
                source: 'geckoterminal'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                chainSupported: this.isChainSupported(chainId, 'geckoterminal'),
                source: 'geckoterminal'
            };
        }
    }

    /**
     * Check liquidity for a single token with fallback APIs
     */
    async checkTokenLiquidity(tokenObject, options = {}) {
        const { primaryAPI = 'dexscreener', minimumLiquidity = MINIMUM_LIQUIDITY } = options;

        const chainId = tokenObject.chainId;
        const tokenAddress = this.getTokenAddress(tokenObject.originalToken);

        if (!chainId || !tokenAddress) {
            return {
                success: false,
                error: 'Missing chainId or token address',
                tokenObject
            };
        }

        let result;

        // Try primary API first
        if (primaryAPI === 'dexscreener') {
            result = await this.checkLiquidityDEXScreener(chainId, tokenAddress);

            // If DEXScreener fails, try GeckoTerminal as backup
            if (!result.success) {
                console.log(`DEXScreener failed for ${tokenAddress}, trying GeckoTerminal...`);
                result = await this.checkLiquidityGeckoTerminal(chainId, tokenAddress);
            }
        } else {
            result = await this.checkLiquidityGeckoTerminal(chainId, tokenAddress);

            // If GeckoTerminal fails, try DEXScreener as backup
            if (!result.success) {
                console.log(`GeckoTerminal failed for ${tokenAddress}, trying DEXScreener...`);
                result = await this.checkLiquidityDEXScreener(chainId, tokenAddress);
            }
        }

        return {
            ...result,
            tokenObject,
            chainId,
            tokenAddress,
            meetsMinimumLiquidity: result.success ? result.totalLiquidity >= minimumLiquidity : false
        };
    }

    /**
     * Process all tokens from your token lists
     */
    async processAllTokensFromLists(options = {}) {
        const {
            minimumLiquidity = MINIMUM_LIQUIDITY,
            batchSize = BATCH_SIZE,
            delayBetweenBatches = REQUEST_DELAY,
            onProgress = null,
            filterBridgeTokensOnly = false,
        } = options;

        // Load token lists
        const { tokenList, inactiveTokenList } = await this.loadTokenLists();

        // Extract all tokens
        const allTokens = this.extractAllTokens(
            tokenList,
            inactiveTokenList
        );

        // Filter tokens if needed
        let tokensToCheck = allTokens;
        if (filterBridgeTokensOnly) {
            tokensToCheck = allTokens.filter(token =>
                token.isOFT || token.isAcross || token.extensions?.oftInfo || token.extensions?.acrossInfo
            );
        }

        console.log(`Found ${tokensToCheck.length} tokens to check liquidity (${allTokens.length} total)`);

        const liquidityChecks = [];
        for (const token of tokensToCheck) {
            if (token.chainId && this.getTokenAddress(token)) {
                liquidityChecks.push({
                    token,
                    checkChainId: token.chainId,
                    checkAddress: this.getTokenAddress(token),
                });
            }
        }

        console.log(`Performing ${liquidityChecks.length} liquidity checks`);

        // Process liquidity checks
        const results = await this.processTokenList(
            liquidityChecks.map(check => ({
                chainId: check.checkChainId,
                address: check.checkAddress,
                symbol: check.token.symbol,
                originalToken: check.token
            })),
            {
                batchSize,
                delayBetweenBatches,
                minimumLiquidity: minimumLiquidity,
                onProgress: (current, total, result) => {
                    const token = result.tokenObject.originalToken;
                    const chainName = CHAIN_KEYS[result.chainId] || result.chainId;
                    const status = result.success ?
                        (result.hasLiquidity ? `$${result.totalLiquidity?.toFixed(2)}` : 'no liquidity') :
                        'failed';

                    if (!result.success) checker.tokensToCheck.push(result)

                    console.log(`${current}/${total} - ${token.symbol} (${chainName}): ${status}`);

                    if (onProgress) onProgress(current, total, result);
                }
            }
        );

        // Aggregate results by original token 
        // TODO: unused peer analytics logic, use or delete
        const tokenResults = new Map();

        for (const result of results.results) {
            const originalToken = result.tokenObject.originalToken;
            const tokenKey = `${originalToken.source}_${originalToken.chainId}_${this.getTokenAddress(originalToken)}`;

            if (!tokenResults.has(tokenKey)) {
                tokenResults.set(tokenKey, {
                    token: originalToken,
                    totalLiquidity: 0,
                    hasAnyLiquidity: false,
                    supportedChains: 0,
                    unsupportedChain: false
                });
            }

            const tokenResult = tokenResults.get(tokenKey);

            if (result.success) {
                if (result.hasLiquidity) {
                    tokenResult.hasAnyLiquidity = true;
                    tokenResult.totalLiquidity += result.totalLiquidity;
                }
            } else {
                if (result.chainSupported === false) {
                    tokenResult.unsupportedChain = true;
                }
            }
        }

        return {
            rawResults: results,
            tokenResults: Array.from(tokenResults.values()),
            summary: {
                totalTokens: tokensToCheck.length,
                totalChecks: liquidityChecks.length,
                tokensWithLiquidity: Array.from(tokenResults.values()).filter(r => r.hasAnyLiquidity).length,
                averageLiquidityPerToken: Array.from(tokenResults.values())
                    .filter(r => r.hasAnyLiquidity)
                    .reduce((sum, r) => sum + r.totalLiquidity, 0) /
                    Array.from(tokenResults.values()).filter(r => r.hasAnyLiquidity).length || 0
            }
        };
    }

    /**
     * Filter tokens that don't meet liquidity criteria
     */
    filterTokens(tokenResults, options = {}) {
        const {
            minimumLiquidity = MINIMUM_LIQUIDITY,
            requireAnyLiquidity = true,
            trueIfBridgeableFalseIfNotBridgeable = true
        } = options;

        const tokensToFlag = tokenResults.filter(result => {
            const token = result.token;

            // Skip if this is a partner token or no liquidity info for that chain
            if (result.unsupportedChain || options.partnerTokenSymbols && options.partnerTokenSymbols.includes(token.symbol)) {
                return false;
            }

            const isUlysses = Boolean(token.underlyingAddress && token.underlyingAddress.length > 0)
            const isBridgeable = Boolean(token.isOFT || token.isAcross)
            const failsLiquidityChecks = (requireAnyLiquidity && !result.hasAnyLiquidity) || result.totalLiquidity < minimumLiquidity

            // Only mark bridgeable tokens otherwise we will delete them
            if (failsLiquidityChecks && !isUlysses) {
                if (trueIfBridgeableFalseIfNotBridgeable) {
                    if (isBridgeable) return true;
                } else {
                    if (!isBridgeable) return true;
                }
            }

            // Token has sufficient liquidity, don't remove
            return false;
        });

        return tokensToFlag;
    }

    async processTokenList(tokens, options = {}) {
        const {
            batchSize = BATCH_SIZE,
            delayBetweenBatches = REQUEST_DELAY,
            minimumLiquidity = MINIMUM_LIQUIDITY,
            primaryAPI = 'dexscreener',
            onProgress = null
        } = options;

        const results = [];
        const errors = [];

        console.log(`Processing ${tokens.length} tokens in batches of ${batchSize}`);

        // Process tokens in batches to avoid rate limiting
        for (let i = 0; i < tokens.length; i += batchSize) {
            const batch = tokens.slice(i, i + batchSize);

            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tokens.length / batchSize)}`);

            // Process batch concurrently
            const batchPromises = batch.map(async (token, index) => {
                try {
                    const result = await this.checkTokenLiquidity(token, { primaryAPI, minimumLiquidity });

                    if (onProgress) {
                        onProgress(i + index + 1, tokens.length, result);
                    }

                    return result;
                } catch (error) {
                    const errorResult = {
                        success: false,
                        error: error.message,
                        tokenObject: token,
                        chainId: token.chainId,
                        tokenAddress: this.getTokenAddress(token)
                    };
                    errors.push(errorResult);
                    return errorResult;
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            // Delay between batches (except for the last batch)
            if (i + batchSize < tokens.length) {
                await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
            }
        }

        return {
            results,
            summary: this.generateSummary(results),
            errors: errors.length > 0 ? errors : null
        };
    }

    /**
     * Generate summary statistics
     */
    generateSummary(results) {
        const successful = results.filter(r => r.success);
        const withLiquidity = successful.filter(r => r.hasLiquidity);
        const totalLiquidity = successful.reduce((sum, r) => sum + (r.totalLiquidity || 0), 0);
        const unsupportedChains = results.filter(r => !r.success && r.chainSupported === false);

        // Chain-wise breakdown
        const chainBreakdown = {};
        results.forEach(result => {
            const chainKey = CHAIN_KEYS[result.chainId] || result.chainId;
            if (!chainBreakdown[chainKey]) {
                chainBreakdown[chainKey] = { total: 0, withLiquidity: 0, supported: true };
            }
            chainBreakdown[chainKey].total++;
            if (result.hasLiquidity) chainBreakdown[chainKey].withLiquidity++;
            if (result.chainSupported === false) chainBreakdown[chainKey].supported = false;
        });

        return {
            total: results.length,
            successful: successful.length,
            failed: results.length - successful.length,
            withLiquidity: withLiquidity.length,
            withoutLiquidity: successful.length - withLiquidity.length,
            unsupportedChains: unsupportedChains.length,
            totalLiquidityUSD: totalLiquidity,
            averageLiquidity: withLiquidity.length > 0 ? totalLiquidity / withLiquidity.length : 0,
            chainBreakdown: chainBreakdown
        };
    }

    checkTheseTokensOut = []

}

async function runLiquidityCheck() {
    const checker = new TokenLiquidityChecker();

    // Show which chains are supported
    const chainInfo = checker.getSupportedChains();
    console.log('Chain Support:', chainInfo);
    console.log('Unsupported chains:', chainInfo.unsupportedChains.map(id => `${CHAIN_KEYS[id]} (${id})`));

    try {
        // Process all tokens
        const result = await checker.processAllTokensFromLists({
            batchSize: BATCH_SIZE,
            delayBetweenBatches: REQUEST_DELAY,
            minimumLiquidity: MINIMUM_LIQUIDITY,
        });

        console.log('\n=== LIQUIDITY ANALYSIS SUMMARY ===');
        console.log(`Total tokens analyzed: ${result.summary.totalTokens}`);
        console.log(`Total liquidity checks: ${result.summary.totalChecks}`);
        console.log(`Tokens with liquidity: ${result.summary.tokensWithLiquidity}`);
        console.log(`Average liquidity per token: ${result.summary.averageLiquidityPerToken.toFixed(2)}`);

        // Show tokens with insufficient liquidity
        const tokensToFlag = checker.filterTokens(result.tokenResults, {
            minimumLiquidity: MINIMUM_LIQUIDITY,
            partnerTokenSymbols: PARTNER_TOKEN_SYMBOLS,
            trueIfBridgeableFalseIfNotBridgeable: true
        });

        // Load token lists
        const { tokenList, inactiveTokenList } = await checker.loadTokenLists();

        if (tokensToFlag.length > 0) {
            for (const tokenToFlag of tokensToFlag) {
                const addrToFlag = checker.getTokenAddress(tokenToFlag.token);
                const chainIdToFlag = tokenToFlag.token.chainId;
                const sourceToFlag = tokenToFlag.token.source;
                if (sourceToFlag === 'rootTokens') {
                    // rootTokens 
                    const rootTokens = tokenList.rootTokens || [];
                    const found = rootTokens.find(t => checker.getTokenAddress(t) === addrToFlag);
                    if (found) {
                        found.noLiquidityOnChain = true;
                    } else {
                        console.warn(`Could not find root token for ${addrToFlag} on chain ${chainIdToFlag}`);
                    }
                } else if (sourceToFlag === 'tokens') {
                    // tokens
                    const tokens = tokenList.tokens || [];
                    const found = tokens.find(t => checker.getTokenAddress(t) === addrToFlag && t.chainId === chainIdToFlag);
                    if (found) {
                        found.noLiquidityOnChain = true;
                    } else {
                        console.warn(`Could not find active token ${addrToFlag} on chain ${chainIdToFlag}`);
                    }
                } else if (sourceToFlag === 'inactive') {
                    // inactive list
                    const inactiveTokens = inactiveTokenList.tokens || [];
                    const found = inactiveTokens.find(t => checker.getTokenAddress(t) === addrToFlag && t.chainId === chainIdToFlag);
                    if (found) {
                        found.noLiquidityOnChain = true;
                    } else {
                        console.warn(`Could not find inactive token ${addrToFlag} on chain ${chainIdToFlag}`);
                    }
                } else {
                    console.warn(`Could not find list to edit for source: ${tokenToFlag.source}`)
                }
            }
        } else {
            console.log('All tokens meet minimum liquidity requirements');
        }

        // Delete non-bridgeable tokens with insufficient liquidity 
        const tokensToDelete = checker.filterTokens(result.tokenResults, {
            minimumLiquidity: MINIMUM_LIQUIDITY,
            partnerTokenSymbols: PARTNER_TOKEN_SYMBOLS,
            trueIfBridgeableFalseIfNotBridgeable: false
        });

        if (tokensToDelete.length > 0) {
            for (const tokenToDelete of tokensToDelete) {
                const addrToDelete = checker.getTokenAddress(tokenToDelete.token);
                const chainIdToDelete = tokenToDelete.token.chainId;
                const sourceToDelete = tokenToDelete.token.source;

                if (sourceToDelete === 'rootTokens') {
                    tokenList.rootTokens = (tokenList.rootTokens || []).filter(
                        t => checker.getTokenAddress(t) !== addrToDelete
                    );

                    console.log(`Removed root token ${addrToDelete} from rootTokens`);

                } else if (sourceToDelete === 'tokens') {
                    // tokens: remove items that match both address and chainId
                    const before = (tokenList.tokens || []).length;
                    tokenList.tokens = (tokenList.tokens || []).filter(
                        t => !(checker.getTokenAddress(t) === addrToDelete && t.chainId === chainIdToDelete)
                    );
                    const after = tokenList.tokens.length;
                    if (after < before) {
                        console.log(`Removed active token ${addrToDelete} on chain ${chainIdToDelete}`);
                    } else {
                        console.warn(`Could not find active token ${addrToDelete} on chain ${chainIdToDelete}`);
                    }

                } else if (sourceToDelete === 'inactive') {
                    // inactive list: same as tokens but on inactiveTokenList
                    const before = (inactiveTokenList.tokens || []).length;
                    inactiveTokenList.tokens = (inactiveTokenList.tokens || []).filter(
                        t => !(checker.getTokenAddress(t) === addrToDelete && t.chainId === chainIdToDelete)
                    );
                    const after = inactiveTokenList.tokens.length;
                    if (after < before) {
                        console.log(`Removed inactive token ${addrToDelete} on chain ${chainIdToDelete}`);
                    } else {
                        console.warn(`Could not find inactive token ${addrToDelete} on chain ${chainIdToDelete}`);
                    }

                } else {
                    console.warn(`Could not find list to edit for source: ${tokenToDelete.source}`);
                }
            }
        } else {
            console.log('All tokens meet minimum liquidity requirements');
        }

        // Save updated files (use checker methods/properties)
        if (typeof checker.writeJson !== 'function') {
            throw new Error('checker.writeJson is not available - cannot save updated token lists.');
        }
        await Promise.all([
            checker.writeJson(checker.tokenListPath, tokenList),
            checker.writeJson(checker.inactiveTokenListPath, inactiveTokenList),
            checker.writeJson(path.resolve(__dirname, '../check-these-tokens-out.json'), checker.tokensToCheck)
        ]);

    } catch (error) {
        console.error('Error processing tokens:', error);
    }


}

// Main execution function
async function main() {
    try {
        await runLiquidityCheck();

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Export for use as module
module.exports = {
    TokenLiquidityChecker,
    runLiquidityCheck,
    main
};

main();