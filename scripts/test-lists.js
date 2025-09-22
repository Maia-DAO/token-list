const { ethers } = require('ethers')
const dataActiveList = require('../token-list.json')
const dataInactiveList = require('../inactive-token-list.json')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function getAddressFromEntry(token) {
  return token.address ?? token.underlyingAddress
}

function tokensExtensionsAreInSameList(listName, list) {
  function logTokenError(token, msg) {
    console.error(`${listName}: ${token.chainId}-${getAddressFromEntry(token)}: ${msg}`)
  }

  const tokens = [...list.tokens, ...(list.rootTokens ?? [])]
  let issues = 0

  tokens.forEach((token) => {
    const mainAddress = getAddressFromEntry(token)
    try {
      if (mainAddress !== ethers.getAddress(mainAddress)) logTokenError(token, 'address not checksummed')
    } catch (error) {
      logTokenError(token, error)
      issues++
    }

    const extensions = token.extensions
    if (extensions) {
      const oftInfo = extensions.oftInfo
      if (oftInfo) {
        const peersInfo = oftInfo.peersInfo
        if (!peersInfo) {
          logTokenError(token, 'peersInfo undefined')
          issues++
        } else {
          const peers = Object.entries(peersInfo)

          peers.forEach(([chain, { tokenAddress: address }]) => {
            if (address === ZERO_ADDRESS) return

            const tokenFound = tokens.find((tokenEntry) => {
              const tokenAddress = getAddressFromEntry(tokenEntry)
              return Number(chain) === tokenEntry.chainId && address === tokenAddress
            })

            if (!tokenFound) {
              logTokenError(token, `peer not found: ${chain}-${address}`)
              issues++
            }
          })
        }
      }

      const acrossInfo = extensions.acrossInfo
      if (acrossInfo) {
        const peers = Object.entries(acrossInfo)

        peers.forEach(([chain, { address }]) => {
          const tokenFound = tokens.find((tokenEntry) => {
            const tokenAddress = getAddressFromEntry(tokenEntry)
            return Number(chain) === tokenEntry.chainId && address === tokenAddress
          })

          if (!tokenFound) {
            logTokenError(token, `across info not found: ${chain}-${address}`)
            issues++
          }
        })
      }
    }
  })

  return issues
}

const activeListWithIssues = tokensExtensionsAreInSameList('ActiveList', dataActiveList)
const inactiveListWithIssues = tokensExtensionsAreInSameList('InactiveList', dataInactiveList)

console.log('Active list issues:', activeListWithIssues)
console.log('Inactive list issues:', inactiveListWithIssues)
console.log('Total list issues:', activeListWithIssues + inactiveListWithIssues)
