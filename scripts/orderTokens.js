function sort(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function orderTokens(tokenA, tokenB) {
  if (tokenA.chainId === tokenB.chainId) {
    const addressA = tokenA.address ?? tokenA.underlyingAddress
    const addressB = tokenB.address ?? tokenB.underlyingAddress

    return sort(addressA, addressB)
  }

  return sort(tokenA.chainId, tokenB.chainId)
}

exports.orderTokens = orderTokens
