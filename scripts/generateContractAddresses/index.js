const fs = require('fs')
const { SUPPORTED_CHAINS, CHAIN_KEY_TO_EID } = require('../../configs')

/**
 * Main function.
 */
function main() {
  const ofts = JSON.parse(fs.readFileSync('output/ofts.json', 'utf8'))

  const ULN_V1_MAPPING = {}
  const ULN_V2_MAPPING = {}

  for (const chainKey of SUPPORTED_CHAINS) {
    console.log(`Processing chain: ${chainKey}`)

    const chainData = ofts[chainKey]
    if (!chainData) continue

    const eidV1 = CHAIN_KEY_TO_EID[chainKey].v1.toString()
    const eidV2 = CHAIN_KEY_TO_EID[chainKey].v2.toString()

    const chainDeployments = chainData.deployments
    if (!chainDeployments) continue

    for (const deployment of chainDeployments) {
      const { eid, stage } = deployment

      if (stage !== 'mainnet') continue // TODO: change if adding support for testnet OFTs

      if (eid === eidV1) {
        ULN_V1_MAPPING[chainKey] = deployment.ultraLightNodeV2?.address
      } else if (eid === eidV2) {
        ULN_V2_MAPPING[chainKey] = deployment.sendUln302?.address
      }
    }
  }
  console.log('Ultra Light Node Addresses Extracted:')
  console.log('ULN V1:', ULN_V1_MAPPING)
  console.log('ULN V2:', ULN_V2_MAPPING)
}

main()
