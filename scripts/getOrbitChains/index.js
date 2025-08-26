const fs = require('fs')
const { SUPPORTED_CHAINS } = require('../../configs')

/**
 * Main function.
 */
function main() {
    const ofts = JSON.parse(fs.readFileSync('output/ofts.json', 'utf8'))

    const ORBIT_CHAINS_ARRAY = []

    for (const chainKey of SUPPORTED_CHAINS) {
        console.log(`Processing chain: ${chainKey}`)

        const chainData = ofts[chainKey]
        if (!chainData) continue

        const chainDetails = chainData.chainDetails
        if (!chainDetails) continue


        if (chainDetails.chainStack === 'ARB_STACK') {
            ORBIT_CHAINS_ARRAY.push(chainKey)
        }
    }
    console.log('Orbit Chains:', ORBIT_CHAINS_ARRAY)
}



main()
