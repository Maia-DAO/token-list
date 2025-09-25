require('dotenv').config()
const TOKEN_LIST = require('../../token-list.json')
const INACTIVE_TOKEN_LIST = require('../../inactive-token-list.json')

function getAllOFTs() {
  return [...TOKEN_LIST.tokens, ...TOKEN_LIST.rootTokens, ...INACTIVE_TOKEN_LIST.tokens].filter((token) => token.isOFT)
}

function groupBy(array, keyFn) {
  const map = new Map()

  for (const item of array) {
    const key = keyFn(item)
    const keyStr = JSON.stringify(key) // Map can't use complex keys directly
    if (!map.has(keyStr)) {
      map.set(keyStr, [])
    }
    map.get(keyStr).push(item)
  }

  return Array.from(map.values())
}

function uniqueToken(token) {
  return token.symbol
}

function getAllUniqueOFTs() {
  return groupBy(getAllOFTs(), uniqueToken)
}

async function getOFTsPriceSource() {
  return (await (await fetch(process.env.OFT_API)).json())[0].result.data
}

function filterOutUnusedTokens(entry, allUniqueOFTs) {
  if (!entry.marketCap) return false
  if (entry.project === 'Stargate' && entry.symbol !== 'STG') return false

  return allUniqueOFTs.some((tokens) => {
    return entry.symbol === tokens[0].symbol
  })
}

async function main() {
  const allUniqueOFTs = getAllUniqueOFTs()
  const oftInfo = await getOFTsPriceSource()

  const oftsWithPriceSource = oftInfo.filter((entry) => filterOutUnusedTokens(entry, allUniqueOFTs))
  const marketCapSum = oftsWithPriceSource.reduce((memo, entry) => memo + entry.marketCap, 0)

  console.log(`Bridgeable Market Cap from ${oftsWithPriceSource.length} tokens: ${marketCapSum}`)
}

main()
