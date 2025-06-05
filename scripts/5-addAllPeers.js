const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const {
    OFT_V3_ABI,
    OFT_V2_ABI,
    ERC20_MINIMAL_ABI,
    SUPPORTED_CHAINS,
    CHAIN_KEY_TO_ID,
    EID_TO_VERSION,
    CHAIN_KEY_TO_EID,
    multiCallWithFallback,
} = require('../constants');
const { ZERO_ADDRESS } = require('maia-core-sdk');

async function main() {
    // ─── A) Load initial tokens from usableStargateTokens.json ─────────────────────────
    const inputPath = path.resolve(__dirname, '../output/usableStargateTokens.json');
    let tokens = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

    // Build a lookup map to avoid enqueueing duplicates:
    const seenAdapters = new Map();
    tokens.forEach((t, idx) => {
        t.index = idx; // assign initial index
        const mapKey = `${t.chainKey.toLowerCase()}:${t.oftAdapter.toLowerCase()}`;
        seenAdapters.set(mapKey, true);
    });

    // Tokens that still need to go through Parts 1→3.
    let toProcess = [...tokens];

    // Constants
    const zeroBytes32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const zeroAddress = ZERO_ADDRESS;

    // ─── B) Loop rounds until no new tokens are discovered ────────────────────────
    while (toProcess.length > 0) {
        console.log(`\n=== Starting a new round. ${toProcess.length} token(s) to process. ===`);
        const newTokens = []; // will collect any freshly discovered peers

        // Group toProcess by chainKey
        const byChain = toProcess.reduce((acc, t) => {
            (acc[t.chainKey] = acc[t.chainKey] || []).push(t);
            return acc;
        }, {});

        // For each chainKey, do Parts 1,2,3 in large batches:
        for (const [chainKey, chainTokens] of Object.entries(byChain)) {
            console.log(`\n→ Processing chainKey="${chainKey}" with ${chainTokens.length} token(s).`);

            //
            // ──────────────────────────────────────────────────────────────────────────────
            // PART 1: endpoint()/lzEndpoint() + token() (3 calls per token)
            // ──────────────────────────────────────────────────────────────────────────────
            //

            // Build one multicall batch for all tokens on this chainKey
            const ifaceEndpoint = new ethers.Interface([
                'function endpoint() view returns (uint16)',
                'function lzEndpoint() view returns (uint16)',
            ]);
            const ifaceProxy = new ethers.Interface(['function token() view returns (address)']);

            const callsPart1 = [];
            const decodeInfoPart1 = []; // decoding helper parallel array

            for (const t of chainTokens) {
                const adapter = t.oftAdapter;
                // 1. endpoint()
                callsPart1.push({
                    target: adapter,
                    callData: ifaceEndpoint.encodeFunctionData('endpoint', []),
                });
                decodeInfoPart1.push({ type: 'endpoint', token: t });

                // 2. lzEndpoint()
                callsPart1.push({
                    target: adapter,
                    callData: ifaceEndpoint.encodeFunctionData('lzEndpoint', []),
                });
                decodeInfoPart1.push({ type: 'lzEndpoint', token: t });

                // 3. token()
                callsPart1.push({
                    target: adapter,
                    callData: ifaceProxy.encodeFunctionData('token', []),
                });
                decodeInfoPart1.push({ type: 'token', token: t });
            }

            // Multicall for Part 1
            let returnData1;
            try {
                returnData1 = await multiCallWithFallback(chainKey, callsPart1, 500, 200);
            } catch (err) {
                console.error(`  [P1] multicall failed on chain ${chainKey}: ${err.message}`);
                // If Part 1 fails entirely for this chainKey, skip Parts 2 & 3 for these tokens
                continue;
            }

            // Decode Part 1
            for (let i = 0; i < decodeInfoPart1.length; i++) {
                const { type, token } = decodeInfoPart1[i];
                const raw = returnData1[i];

                try {
                    if (type === 'endpoint') {
                        // If endpoint() returns non‐zero, mark V2
                        if (raw && raw !== '0x' && raw.length > 0) {
                            token.endpointVersion = 2;
                            if (!token.endpointId || EID_TO_VERSION[token.endpointId] === 1) {
                                token.endpointId = CHAIN_KEY_TO_EID[token.chainKey].v2;
                            }
                        }
                    } else if (type === 'lzEndpoint') {
                        // If lzEndpoint() returns non‐zero, mark V1
                        if (raw && raw !== '0x' && raw.length > 0) {
                            token.endpointVersion = 1;
                            if (!token.endpointId || EID_TO_VERSION[token.endpointId] === 2) {
                                token.endpointId = CHAIN_KEY_TO_EID[token.chainKey].v1;
                            }
                        }
                    } else if (type === 'token') {
                        // If token() returns a non‐zero address, override token.address
                        if (raw && raw !== '0x') {
                            const decodedAddr = ifaceProxy.decodeFunctionResult('token', raw)[0];
                            if (decodedAddr && decodedAddr.toLowerCase() !== zeroAddress) {
                                token.address = decodedAddr;
                            }
                        }
                    }
                } catch (e) {
                    // ignore individual decode errors
                }
            }

            //
            // ──────────────────────────────────────────────────────────────────────────────
            // PART 2: sharedDecimals + ERC20 name/symbol/decimals + send/sendFrom checks
            // ──────────────────────────────────────────────────────────────────────────────
            //
            const ifaceV3 = new ethers.Interface(OFT_V3_ABI);
            const ifaceERC = new ethers.Interface(ERC20_MINIMAL_ABI);
            const ifaceV2 = new ethers.Interface(OFT_V2_ABI);
            const ifaceV1 = new ethers.Interface([
                'function sendFrom(address,uint16,bytes,uint256,address,address,bytes) payable',
            ]);

            const callsPart2 = [];
            const decodeInfoPart2 = [];

            for (const t of chainTokens) {
                const adapter = t.oftAdapter;
                const tokenAddr = t.address;

                // 1. sharedDecimals()
                callsPart2.push({
                    target: adapter,
                    callData: ifaceV3.encodeFunctionData('sharedDecimals', []),
                });
                decodeInfoPart2.push({ type: 'sharedDecimals', token: t });

                // 2. name()
                callsPart2.push({
                    target: tokenAddr,
                    callData: ifaceERC.encodeFunctionData('name', []),
                });
                decodeInfoPart2.push({ type: 'ercName', token: t });

                // 3. symbol()
                callsPart2.push({
                    target: tokenAddr,
                    callData: ifaceERC.encodeFunctionData('symbol', []),
                });
                decodeInfoPart2.push({ type: 'ercSymbol', token: t });

                // 4. decimals()
                callsPart2.push({
                    target: tokenAddr,
                    callData: ifaceERC.encodeFunctionData('decimals', []),
                });
                decodeInfoPart2.push({ type: 'ercDecimals', token: t });

                // 5. V3.send(dummy)
                callsPart2.push({
                    target: adapter,
                    callData: ifaceV3.encodeFunctionData('send', [
                        [0, zeroBytes32, 0, 0, '0x', '0x', '0x'],
                        [0, 0],
                        zeroAddress,
                    ]),
                });
                decodeInfoPart2.push({ type: 'checkSendV3', token: t });

                // 6. V2.sendFrom(dummy)
                callsPart2.push({
                    target: adapter,
                    callData: ifaceV2.encodeFunctionData('sendFrom', [
                        zeroAddress,
                        0,
                        zeroBytes32,
                        0,
                        [zeroAddress, zeroAddress, '0x'],
                    ]),
                });
                decodeInfoPart2.push({ type: 'checkSendV2', token: t });

                // 7. V1.sendFrom(dummy)
                callsPart2.push({
                    target: adapter,
                    callData: ifaceV1.encodeFunctionData('sendFrom', [
                        zeroAddress,
                        0,
                        '0x',
                        0,
                        zeroAddress,
                        zeroAddress,
                        '0x',
                    ]),
                });
                decodeInfoPart2.push({ type: 'checkSendV1', token: t });
            }

            // Multicall for Part 2
            let returnData2;
            try {
                returnData2 = await multiCallWithFallback(chainKey, callsPart2, 500, 200);
            } catch (err) {
                console.error(`  [P2] multicall failed on chain ${chainKey}: ${err.message}`);
                // Skip Part 3 for these tokens if Part 2 fails.
                continue;
            }

            // Decode Part 2
            for (let i = 0; i < decodeInfoPart2.length; i++) {
                const { type, token } = decodeInfoPart2[i];
                const raw = returnData2[i];

                try {
                    if (type === 'sharedDecimals') {
                        if (raw && raw !== '0x') {
                            const sharedDecimals = parseInt(
                                ifaceV3.decodeFunctionResult('sharedDecimals', raw)[0]
                            );
                            if (sharedDecimals > 0) {
                                token.oftSharedDecimals = sharedDecimals;
                                // Shared Decimals implies V2
                                token.endpointVersion = 2;
                                if (!token.endpointId || EID_TO_VERSION[token.endpointId] === 1) {
                                    token.endpointId = CHAIN_KEY_TO_EID[token.chainKey].v2;
                                }
                            }
                        }
                    } else if (type === 'ercName') {
                        if (raw && raw !== '0x') {
                            try {
                                token.name = ifaceERC.decodeFunctionResult('name', raw)[0];
                            } catch {
                                token._remove = true;
                            }
                        } else {
                            token._remove = true;
                        }
                    } else if (type === 'ercSymbol') {
                        if (raw && raw !== '0x') {
                            try {
                                token.symbol = ifaceERC.decodeFunctionResult('symbol', raw)[0];
                            } catch {
                                token._remove = true;
                            }
                        } else {
                            token._remove = true;
                        }
                    } else if (type === 'ercDecimals') {
                        if (raw && raw !== '0x') {
                            try {
                                token.decimals = parseInt(
                                    ifaceERC.decodeFunctionResult('decimals', raw)[0]
                                );
                            } catch {
                                token._remove = true;
                            }
                        } else {
                            token._remove = true;
                        }
                    } else if (type === 'checkSendV3') {
                        if (raw && raw !== '0x' && !token._remove) {
                            token.oftVersion = 3;
                            // OFT V3 implies Endpoint V2
                            token.endpointVersion = 2;
                            if (!token.endpointId || EID_TO_VERSION[token.endpointId] === 1) {
                                token.endpointId = CHAIN_KEY_TO_EID[token.chainKey].v2;
                            }
                        }
                    } else if (type === 'checkSendV2') {
                        if (raw && raw !== '0x' && !token._remove) {
                            token.oftVersion = 2;
                            // OFT V2 implies Endpoint V1
                            token.endpointVersion = 1;
                            if (!token.endpointId || EID_TO_VERSION[token.endpointId] === 2) {
                                token.endpointId = CHAIN_KEY_TO_EID[token.chainKey].v1;
                            }
                        }
                    } else if (type === 'checkSendV1') {
                        if (raw && raw !== '0x' && !token._remove) {
                            token.oftVersion = 1;
                            // OFT V1 implies Endpoint V1
                            token.endpointVersion = 1;
                            if (!token.endpointId || EID_TO_VERSION[token.endpointId] === 2) {
                                token.endpointId = CHAIN_KEY_TO_EID[token.chainKey].v1;
                            }
                        }
                    }
                } catch {
                    // ignore individual decode errors
                }
            }

            //
            // ──────────────────────────────────────────────────────────────────────────────
            // PART 3: discover peers (one call per token×destChain, batched)
            // ──────────────────────────────────────────────────────────────────────────────
            const callsPart3 = [];
            const decodeInfoPart3 = [];

            for (const t of chainTokens) {
                if (t._remove) continue; // skip non-tokens

                const adapter = t.oftAdapter;
                const eid = t.endpointId;
                const requireV3 = EID_TO_VERSION[eid] === 2 || t.endpointVersion === 2;
                const ifaceV3b = new ethers.Interface(OFT_V3_ABI);
                const ifaceV2b = new ethers.Interface(OFT_V2_ABI);

                for (const otherChainKey of SUPPORTED_CHAINS) {
                    if (otherChainKey === chainKey) continue;

                    const destChainId = requireV3
                        ? CHAIN_KEY_TO_EID[otherChainKey].v2
                        : CHAIN_KEY_TO_EID[otherChainKey].v1;
                    if (!destChainId) continue;

                    if (requireV3) {
                        // V3.peers(destChainId)
                        callsPart3.push({
                            target: adapter,
                            callData: ifaceV3b.encodeFunctionData('peers', [destChainId]),
                        });
                        decodeInfoPart3.push({
                            type: 'peers',
                            token: t,
                            destChainKey: otherChainKey,
                            destChainId,
                        });
                    } else {
                        // V2,V1.getTrustedRemoteAddress(destChainId)
                        callsPart3.push({
                            target: adapter,
                            callData: ifaceV2b.encodeFunctionData('getTrustedRemoteAddress', [
                                destChainId,
                            ]),
                        });
                        decodeInfoPart3.push({
                            type: 'trusted',
                            token: t,
                            destChainKey: otherChainKey,
                            destChainId,
                        });
                    }
                }
            }

            if (callsPart3.length === 0) {
                console.log(`  [P3] No peer calls needed for chain ${chainKey}.`);
            } else {
                // Batch size = #callsPart3
                let returnData3;
                try {
                    returnData3 = await multiCallWithFallback(chainKey, callsPart3, 500, 200);
                } catch (err) {
                    console.error(`  [P3] multicall failed on chain ${chainKey}: ${err.message}`);
                    // Skip decoding if Part 3 fails
                    continue;
                }

                // Decode Part 3
                for (let i = 0; i < decodeInfoPart3.length; i++) {
                    const { type, token, destChainKey } = decodeInfoPart3[i];
                    const raw = returnData3[i];

                    if (!raw || raw === '0x' || raw === zeroBytes32) continue; // skip empty results

                    try {
                        // Ensure peersInfo exists
                        token.extensions = token.extensions || {};
                        token.extensions.peersInfo = token.extensions.peersInfo || {};

                        const chainId = CHAIN_KEY_TO_ID[destChainKey];
                        if (!chainId) continue;

                        if (type === 'peers') {
                            // decode V3.peers(uint32)
                            const ifaceV3c = new ethers.Interface(OFT_V3_ABI);
                            const decoded = ifaceV3c.decodeFunctionResult('peers', raw);
                            const addrBytes = decoded[0];

                            if (!addrBytes || addrBytes === '0x' || addrBytes === zeroBytes32) continue;

                            const rawAddressHex = '0x' + addrBytes.slice(-40);
                            let peerAddr;
                            try {
                                peerAddr = ethers.getAddress(rawAddressHex);
                            } catch {
                                continue;
                            }

                            token.extensions.peersInfo[chainId] = { tokenAddress: peerAddr };

                            // If unseen, queue a new token
                            const mapKey = `${destChainKey.toLowerCase()}:${peerAddr.toLowerCase()}`;
                            if (!seenAdapters.has(mapKey)) {
                                const newIndex = tokens.length;
                                const newToken = {
                                    chainKey: destChainKey,
                                    chainId: CHAIN_KEY_TO_ID[destChainKey],
                                    oftAdapter: peerAddr,
                                    address: peerAddr,
                                    extensions: {},
                                    index: newIndex,
                                };
                                tokens.push(newToken);
                                newTokens.push(newToken);
                                seenAdapters.set(mapKey, true);
                            }
                        } else if (type === 'trusted') {
                            // decode V2.getTrustedRemoteAddress(uint16)
                            const ifaceV2c = new ethers.Interface(OFT_V2_ABI);
                            const decoded = ifaceV2c.decodeFunctionResult(
                                'getTrustedRemoteAddress',
                                raw
                            );
                            const returned = decoded[0];
                            if (!returned || returned === '0x' || returned === ZERO_ADDRESS) continue;

                            token.extensions.peersInfo[chainId] = { tokenAddress: returned };

                            // If unseen, enqueue new
                            const mapKey = `${destChainKey.toLowerCase()}:${returned.toLowerCase()}`;
                            if (!seenAdapters.has(mapKey)) {
                                const newIndex = tokens.length;
                                const newToken = {
                                    chainKey: destChainKey,
                                    chainId: CHAIN_KEY_TO_ID[destChainKey],
                                    oftAdapter: returned,
                                    address: returned,
                                    extensions: {},
                                    index: newIndex,
                                };
                                tokens.push(newToken);
                                newTokens.push(newToken);
                                seenAdapters.set(mapKey, true);
                            }
                        }
                    } catch {
                        // ignore decode/update errors
                    }
                }
            }
        }

        // All tokens in toProcess have now been handled.  Next round uses newTokens.
        toProcess = newTokens;
    }

    // ─── C) Final filtering & write‐out ────────────────────────────────────────────
    const finalTokens = tokens.filter((t) => !t._remove);

    // Re‐index 0…N−1
    for (let i = 0; i < finalTokens.length; i++) {
        finalTokens[i].index = i;
    }

    // For each peersInfo token address find a matching token address in the tokens array that has that token address as oftAdapter and same chainId
    for (const t of finalTokens) {
        if (!t.extensions || !t.extensions.peersInfo) continue;

        for (const [chainId, peerInfo] of Object.entries(t.extensions.peersInfo)) {
            const peerAddress = peerInfo.tokenAddress;
            const matchingToken = tokens.find(
                token => token.chainId === parseInt(chainId) && token.oftAdapter.toLowerCase() === peerAddress.toLowerCase()
            );

            if (matchingToken) {
                t.extensions.peersInfo[chainId].tokenAddress = matchingToken.address;
                console.log(`✅ Found matching token for ${peerAddress} on chain ${chainId}: ${matchingToken.name} (${matchingToken.symbol} new address: ${matchingToken.address})`);
            } else {
                console.warn(`⚠️ Token ${t.address}: No matching token found for peer address ${peerAddress} on chain ${chainId}`);
            }
        }
    }

    fs.writeFileSync(inputPath, JSON.stringify(finalTokens, null, 2), 'utf8');
    console.log(`\n✅ Finished. Wrote ${finalTokens.length} tokens to ${inputPath}.`);
}

main().catch((e) => {
    console.error('Fatal error in main():', e);
    process.exit(1);
});
