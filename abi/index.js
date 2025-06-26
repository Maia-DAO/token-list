const ERC20_MINIMAL_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]

const OAPP_ABI = ['function endpoint() view returns (address)', 'function lzEndpoint() view returns (address)']

const OFT_V3_ABI = [
  'function send((uint32 dstChainId,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),(uint256 nativeFee,uint256 lzTokenFee),address refundAddress) payable returns ((bytes32 guid,uint64 nonce,(uint256 nativeFee,uint256 lzTokenFee)),(uint256 amountSentLD,uint256 amountReceivedLD))',
  'function quoteOFT((uint32,bytes32,uint256,uint256,bytes,bytes,bytes)) view returns ((uint256 nativeFee,uint256 lzTokenFee),(int256,string)[],(uint256 sent,uint256 received))',
  'function sharedDecimals() view returns (uint8)',
  'function peers(uint32) view returns (bytes32)',
]
const OFT_V2_ABI = [
  'function sendFrom(address from,uint16 dstChainId,bytes32 toAddress,uint256 amount,(address payable refundAddress,address zroPaymentAddress,bytes adapterParams)) payable',
  'function quoteOFTFee(uint16 dstChainId,uint256 amount) view returns (uint256 fee)',
  'function sharedDecimals() view returns (uint8)',
  'function getTrustedRemoteAddress(uint16) view returns (bytes)',
]

const OFT_V1_ABI = [
  'function sendFrom(address from,uint16 dstChainId,bytes toAddress,uint256 amount,address payable refundAddress,address zroPaymentAddress,bytes adapterParams) payable',
]

const MULTICALL3_ABI = [
  'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool,bytes)[])',
]

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

module.exports = {
  OAPP_ABI,
  OFT_V3_ABI,
  OFT_V2_ABI,
  OFT_V1_ABI,
  ERC20_MINIMAL_ABI,
  MULTICALL3_ABI,
  MULTICALL3_ADDRESS
}
