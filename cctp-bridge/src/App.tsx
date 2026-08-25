import { useEffect, useMemo, useState } from 'react'
import { getAddress, getNetwork, isConnected, requestAccess, setAllowed, signTransaction } from '@stellar/freighter-api'
import { Contract, Networks, StrKey, TransactionBuilder, rpc, xdr } from '@stellar/stellar-sdk'
import { decodeFunctionData, encodeFunctionData, formatUnits, parseUnits } from 'viem'
import './App.css'

type Hex = `0x${string}`
type Environment = 'mainnet' | 'testnet'
type TransferMode = 'standard' | 'fast'
type Source = { name: string; short: string; chainId: number; domain: number; usdc: Hex; logo: string; fast: boolean; explorer: string }
type NetworkConfig = { sources: Source[]; messenger: Hex; forwarder: string; stellarRpc: string; stellarPassphrase: string; stellarNetwork: string; stellarHorizon: string; stellarUsdcIssuer: string; iris: string }
type BridgeStep = 'idle' | 'approving' | 'burning' | 'attesting' | 'forwarding' | 'complete' | 'error'
type QuoteStatus = 'idle' | 'loading' | 'ready' | 'error'
type SourceGasQuote = {
  status: QuoteStatus
  approvalRequired: boolean
  approvalCost: bigint | null
  burnCost: bigint | null
  nativeBalance: bigint | null
  error?: string
}

const NETWORKS: Record<Environment, NetworkConfig> = {
  mainnet: {
    messenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d', forwarder: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
    stellarRpc: 'https://soroban-rpc.mainnet.stellar.org', stellarPassphrase: Networks.PUBLIC, stellarNetwork: 'PUBLIC', stellarHorizon: 'https://horizon.stellar.org', stellarUsdcIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', iris: 'https://iris-api.circle.com/v2/messages',
    sources: [
      { name: 'Ethereum', short: 'ETH', chainId: 1, domain: 0, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', logo: '◆', fast: true, explorer: 'https://etherscan.io/tx/' },
      { name: 'Base', short: 'BASE', chainId: 8453, domain: 6, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', logo: 'B', fast: true, explorer: 'https://basescan.org/tx/' },
      { name: 'Arbitrum', short: 'ARB', chainId: 42161, domain: 3, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', logo: 'A', fast: true, explorer: 'https://arbiscan.io/tx/' },
      { name: 'OP Mainnet', short: 'OP', chainId: 10, domain: 2, usdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', logo: 'OP', fast: true, explorer: 'https://optimistic.etherscan.io/tx/' },
      { name: 'Polygon', short: 'POL', chainId: 137, domain: 7, usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', logo: '⬡', fast: true, explorer: 'https://polygonscan.com/tx/' },
      { name: 'Avalanche', short: 'AVAX', chainId: 43114, domain: 1, usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', logo: '▲', fast: false, explorer: 'https://snowtrace.io/tx/' },
    ],
  },
  testnet: {
    messenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA', forwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
    stellarRpc: 'https://soroban-testnet.stellar.org', stellarPassphrase: Networks.TESTNET, stellarNetwork: 'TESTNET', stellarHorizon: 'https://horizon-testnet.stellar.org', stellarUsdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', iris: 'https://iris-api-sandbox.circle.com/v2/messages',
    sources: [
      { name: 'Ethereum Sepolia', short: 'ETH', chainId: 11155111, domain: 0, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', logo: '◆', fast: true, explorer: 'https://sepolia.etherscan.io/tx/' },
      { name: 'Avalanche Fuji', short: 'AVAX', chainId: 43113, domain: 1, usdc: '0x5425890298aed601595a70AB815c96711a31Bc65', logo: '▲', fast: false, explorer: 'https://testnet.snowtrace.io/tx/' },
      { name: 'OP Sepolia', short: 'OP', chainId: 11155420, domain: 2, usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', logo: 'OP', fast: true, explorer: 'https://sepolia-optimism.etherscan.io/tx/' },
      { name: 'Arbitrum Sepolia', short: 'ARB', chainId: 421614, domain: 3, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', logo: 'A', fast: true, explorer: 'https://sepolia.arbiscan.io/tx/' },
      { name: 'Base Sepolia', short: 'BASE', chainId: 84532, domain: 6, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', logo: 'B', fast: true, explorer: 'https://base-sepolia.blockscout.com/tx/' },
      { name: 'Polygon Amoy', short: 'POL', chainId: 80002, domain: 7, usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', logo: '⬡', fast: true, explorer: 'https://amoy.polygonscan.com/tx/' },
      { name: 'Unichain Sepolia', short: 'UNI', chainId: 1301, domain: 10, usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F', logo: 'U', fast: true, explorer: 'https://unichain-sepolia.blockscout.com/tx/' },
      { name: 'Linea Sepolia', short: 'LINEA', chainId: 59141, domain: 11, usdc: '0xFEce4462D57bD51A6A552365A011b95f0E16d9B7', logo: 'L', fast: true, explorer: 'https://sepolia.lineascan.build/tx/' },
      { name: 'Arc Testnet', short: 'ARC', chainId: 5042002, domain: 26, usdc: '0x3600000000000000000000000000000000000000', logo: 'A', fast: false, explorer: 'https://testnet.arcscan.app/tx/' },
    ],
  },
}

const erc20 = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

const TESTNET_WALLET_NETWORKS: Record<number, { chainName: string; rpc: string; symbol: string; decimals: number; explorer: string }> = {
  11155111: { chainName: 'Ethereum Sepolia', rpc: 'https://rpc.sepolia.org', symbol: 'ETH', decimals: 18, explorer: 'https://sepolia.etherscan.io' },
  43113: { chainName: 'Avalanche Fuji', rpc: 'https://api.avax-test.network/ext/bc/C/rpc', symbol: 'AVAX', decimals: 18, explorer: 'https://testnet.snowtrace.io' },
  11155420: { chainName: 'OP Sepolia', rpc: 'https://sepolia.optimism.io', symbol: 'ETH', decimals: 18, explorer: 'https://sepolia-optimism.etherscan.io' },
  421614: { chainName: 'Arbitrum Sepolia', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', symbol: 'ETH', decimals: 18, explorer: 'https://sepolia.arbiscan.io' },
  84532: { chainName: 'Base Sepolia', rpc: 'https://sepolia.base.org', symbol: 'ETH', decimals: 18, explorer: 'https://base-sepolia.blockscout.com' },
  80002: { chainName: 'Polygon Amoy', rpc: 'https://rpc-amoy.polygon.technology', symbol: 'POL', decimals: 18, explorer: 'https://amoy.polygonscan.com' },
  1301: { chainName: 'Unichain Sepolia', rpc: 'https://sepolia.unichain.org', symbol: 'ETH', decimals: 18, explorer: 'https://unichain-sepolia.blockscout.com' },
  59141: { chainName: 'Linea Sepolia', rpc: 'https://rpc.sepolia.linea.build', symbol: 'ETH', decimals: 18, explorer: 'https://sepolia.lineascan.build' },
  5042002: { chainName: 'Arc Testnet', rpc: 'https://rpc.testnet.arc.network', symbol: 'USDC', decimals: 6, explorer: 'https://testnet.arcscan.app' },
}

const cctp = [{ type: 'function', name: 'depositForBurnWithHook', stateMutability: 'nonpayable', inputs: [
  { name: 'amount', type: 'uint256' }, { name: 'destinationDomain', type: 'uint32' }, { name: 'mintRecipient', type: 'bytes32' },
  { name: 'burnToken', type: 'address' }, { name: 'destinationCaller', type: 'bytes32' }, { name: 'maxFee', type: 'uint256' },
  { name: 'minFinalityThreshold', type: 'uint32' }, { name: 'hookData', type: 'bytes' },
], outputs: [] }] as const

declare global { interface Window { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void } } }

const clip = (value: string, left = 6, right = 4) => `${value.slice(0, left)}…${value.slice(-right)}`
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
const bytesToHex = (bytes: Uint8Array) => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex
const hexToBytes = (hex: Hex) => Uint8Array.from((hex.slice(2).match(/.{1,2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)))
const isValidStellarRecipient = (address: string) => StrKey.isValidEd25519PublicKey(address) || StrKey.isValidMed25519PublicKey(address) || StrKey.isValidContract(address)
const CCTP_DESTINATION_DOMAIN = 27
const FAST_FINALITY_THRESHOLD = 1000
const STANDARD_FINALITY_THRESHOLD = 2000
const MAX_BURN_UNITS = 10_000_000n * 1_000_000n

const formatTokenUnits = (units: bigint, decimals: number, maximumFractionDigits = decimals) => {
  const raw = formatUnits(units, decimals)
  const [whole, fraction = ''] = raw.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const clippedFraction = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '')
  return clippedFraction ? `${grouped}.${clippedFraction}` : grouped
}

const nativeSymbol = (chainId: number) => chainId === 137 || chainId === 80002 ? 'POL' : chainId === 43114 || chainId === 43113 ? 'AVAX' : chainId === 5042002 ? 'USDC' : 'ETH'
const nativeDecimals = (chainId: number) => chainId === 5042002 ? 6 : 18
const formatXlmStroops = (stroops: bigint | string) => formatTokenUnits(BigInt(stroops), 7, 7)

const calculateProtocolFee = (amount: bigint, bps: string) => {
  if (!/^\d+(\.\d+)?$/.test(bps)) throw new Error('Circle returned an invalid fee rate.')
  const [whole, fraction = ''] = bps.split('.')
  const numerator = BigInt(`${whole}${fraction}`)
  const denominator = 10_000n * (10n ** BigInt(fraction.length))
  return amount * numerator / denominator
}

const addFeeBuffer = (fee: bigint) => fee === 0n ? 0n : (fee * 120n + 99n) / 100n

const fetchCircleFeeRate = async (irisMessagesUrl: string, sourceDomain: number, finalityThreshold: number, signal?: AbortSignal) => {
  const irisBase = irisMessagesUrl.replace(/\/v2\/messages\/?$/, '')
  const response = await fetch(`${irisBase}/v2/burn/USDC/fees/${sourceDomain}/${CCTP_DESTINATION_DOMAIN}`, { signal })
  if (!response.ok) throw new Error(`Circle fee service returned ${response.status}.`)
  const fees = await response.json() as Array<{ finalityThreshold: number; minimumFee: number | string }>
  const match = fees.find((item) => item.finalityThreshold === finalityThreshold)
  if (!match) throw new Error('Circle did not return a fee for the selected finality.')
  const bps = String(match.minimumFee)
  if (!/^\d+(\.\d+)?$/.test(bps)) throw new Error('Circle returned an invalid fee rate.')
  return bps
}

const buildHookData = (recipient: string) => {
  const recipientBytes = new TextEncoder().encode(recipient)
  const bytes = new Uint8Array(32 + recipientBytes.length)
  new DataView(bytes.buffer).setUint32(28, recipientBytes.length, false)
  bytes.set(recipientBytes, 32)
  return bytesToHex(bytes)
}

// Circle's Stellar Forwarder expects hook data encoded as a bytes32 length prefix
// followed by the UTF-8 Stellar recipient. Decode it again rather than trusting
// the value we meant to encode.
const decodeHookRecipient = (hookData: Hex) => {
  const bytes = hexToBytes(hookData)
  if (bytes.length < 32) throw new Error('CCTP hook data is too short.')
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(28, false)
  if (length !== bytes.length - 32) throw new Error('CCTP hook recipient length is invalid.')
  const recipient = new TextDecoder().decode(bytes.slice(32))
  if (!isValidStellarRecipient(recipient)) throw new Error('CCTP hook contains an invalid Stellar recipient.')
  return recipient
}

const decodeRecipientFromBurnCalldata = (calldata: Hex) => {
  const decoded = decodeFunctionData({ abi: cctp, data: calldata })
  const hookData = (decoded.args as readonly unknown[] | undefined)?.[7]
  if (typeof hookData !== 'string' || !hookData.startsWith('0x')) throw new Error('Could not read hook data from the CCTP burn calldata.')
  return decodeHookRecipient(hookData as Hex)
}

function App() {
  const [environment, setEnvironment] = useState<Environment>('mainnet')
  const config = NETWORKS[environment]
  const [source, setSource] = useState(NETWORKS.mainnet.sources[1])
  const [evmAddress, setEvmAddress] = useState('')
  const [stellarAddress, setStellarAddress] = useState('')
  const [stellarNetwork, setStellarNetwork] = useState('')
  const [amount, setAmount] = useState('')
  const [balance, setBalance] = useState<bigint | null>(null)
  const [balanceStatus, setBalanceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [balanceRefresh, setBalanceRefresh] = useState(0)
  const [stellarUsdcBalance, setStellarUsdcBalance] = useState<string | null>(null)
  const [stellarXlmBalance, setStellarXlmBalance] = useState<string | null>(null)
  const [stellarBalanceStatus, setStellarBalanceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [stellarBalanceRefresh, setStellarBalanceRefresh] = useState(0)
  const [step, setStep] = useState<BridgeStep>('idle')
  const [notice, setNotice] = useState('')
  const [burnHash, setBurnHash] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [finality, setFinality] = useState<TransferMode>('standard')
  const [recipientToConfirm, setRecipientToConfirm] = useState('')
  const [feeStatus, setFeeStatus] = useState<QuoteStatus>('idle')
  const [feeRateBps, setFeeRateBps] = useState<string | null>(null)
  const [feeFetchedAt, setFeeFetchedAt] = useState<number | null>(null)
  const [feeError, setFeeError] = useState('')
  const [confirmedMaxFee, setConfirmedMaxFee] = useState<bigint | null>(null)
  const [sourceGas, setSourceGas] = useState<SourceGasQuote>({ status: 'idle', approvalRequired: true, approvalCost: null, burnCost: null, nativeBalance: null })
  const [stellarInclusionFee, setStellarInclusionFee] = useState<string | null>(null)
  const [stellarPreparedFee, setStellarPreparedFee] = useState<string | null>(null)

  const amountUnits = useMemo(() => { try { return amount ? parseUnits(amount, 6) : 0n } catch { return 0n } }, [amount])
  const protocolFeeUnits = useMemo(() => feeRateBps === null ? 0n : calculateProtocolFee(amountUnits, feeRateBps), [amountUnits, feeRateBps])
  const maxProtocolFeeUnits = useMemo(() => addFeeBuffer(protocolFeeUnits), [protocolFeeUnits])
  const estimatedReceiveUnits = amountUnits > protocolFeeUnits ? amountUnits - protocolFeeUnits : 0n
  const minimumReceiveUnits = amountUnits > maxProtocolFeeUnits ? amountUnits - maxProtocolFeeUnits : 0n
  const validAmount = amountUnits > 0n && amountUnits <= MAX_BURN_UNITS && balance !== null && amountUnits <= balance
  const exactSourceGasCost = (sourceGas.approvalCost ?? 0n) + (sourceGas.burnCost ?? 0n)
  const sourceGasInsufficient = sourceGas.status === 'ready' && sourceGas.burnCost !== null && sourceGas.nativeBalance !== null && sourceGas.nativeBalance < exactSourceGasCost
  const ready = Boolean(evmAddress && stellarAddress && validAmount && feeStatus === 'ready' && !sourceGasInsufficient && ['idle', 'error'].includes(step))
  const finalityThreshold = finality === 'fast' ? FAST_FINALITY_THRESHOLD : STANDARD_FINALITY_THRESHOLD
  const routeSummary = `${source.name} → Stellar ${environment === 'testnet' ? 'Testnet' : ''}`

  useEffect(() => {
    const restore = async () => {
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' }) as string[]
        if (accounts[0]) setEvmAddress(accounts[0])
      }
      try {
        const connected = await isConnected()
        if (connected.isConnected) {
          const address = await getAddress()
          if (address.address) setStellarAddress(address.address)
          const network = await getNetwork()
          if (network.network) setStellarNetwork(network.network)
        }
      } catch { /* Wallet is optional until user connects it. */ }
    }
    void restore()
  }, [])

  useEffect(() => {
    if (!evmAddress || !window.ethereum) return
    let active = true
    const fetchBalance = async () => {
      setBalanceStatus('loading')
      try {
        const data = encodeFunctionData({ abi: erc20, functionName: 'balanceOf', args: [evmAddress as Hex] })
        const result = await window.ethereum!.request({ method: 'eth_call', params: [{ to: source.usdc, data }, 'latest'] }) as Hex
        if (active) { setBalance(BigInt(result)); setBalanceStatus('ready') }
      } catch { if (active) { setBalance(null); setBalanceStatus('error') } }
    }
    void fetchBalance()
    return () => { active = false }
  }, [evmAddress, source, balanceRefresh])

  useEffect(() => {
    if (!stellarAddress || !StrKey.isValidEd25519PublicKey(stellarAddress)) return
    let active = true
    const fetchStellarBalance = async () => {
      setStellarBalanceStatus('loading')
      try {
        const response = await fetch(`${config.stellarHorizon}/accounts/${stellarAddress}`)
        if (!response.ok) throw new Error('Stellar account is unavailable.')
        const account = await response.json() as { balances?: Array<{ balance: string; asset_type: string; asset_code?: string; asset_issuer?: string }> }
        const usdc = account.balances?.find((item) => item.asset_type !== 'native' && item.asset_code === 'USDC' && item.asset_issuer === config.stellarUsdcIssuer)
        const xlm = account.balances?.find((item) => item.asset_type === 'native')
        if (active) { setStellarUsdcBalance(usdc?.balance ?? '0'); setStellarXlmBalance(xlm?.balance ?? '0'); setStellarBalanceStatus('ready') }
      } catch { if (active) { setStellarUsdcBalance(null); setStellarXlmBalance(null); setStellarBalanceStatus('error') } }
    }
    void fetchStellarBalance()
    return () => { active = false }
  }, [stellarAddress, config, stellarBalanceRefresh])

  useEffect(() => {
    if (!window.ethereum?.on) return
    const refreshBalance = () => setBalanceRefresh((value) => value + 1)
    const updateAccount = (accounts: unknown) => {
      setEvmAddress((accounts as string[])[0] ?? '')
      refreshBalance()
    }
    window.ethereum.on('chainChanged', refreshBalance)
    window.ethereum.on('accountsChanged', updateAccount)
    return () => {
      window.ethereum?.removeListener?.('chainChanged', refreshBalance)
      window.ethereum?.removeListener?.('accountsChanged', updateAccount)
    }
  }, [])

  useEffect(() => {
    let active = true
    let controller = new AbortController()
    const loadFee = async () => {
      controller.abort()
      controller = new AbortController()
      setFeeStatus('loading')
      setFeeError('')
      try {
        const bps = await fetchCircleFeeRate(config.iris, source.domain, finalityThreshold, controller.signal)
        if (active) { setFeeRateBps(bps); setFeeFetchedAt(Date.now()); setFeeStatus('ready') }
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return
        setFeeRateBps(null)
        setFeeStatus('error')
        setFeeError(error instanceof Error ? error.message : 'Live Circle fee quote is unavailable.')
      }
    }
    void loadFee()
    const refresh = window.setInterval(() => void loadFee(), 60_000)
    return () => { active = false; controller.abort(); window.clearInterval(refresh) }
  }, [config.iris, source.domain, finalityThreshold])

  useEffect(() => {
    let active = true
    const loadStellarFee = async () => {
      try {
        const stats = await new rpc.Server(config.stellarRpc).getFeeStats()
        if (active) setStellarInclusionFee(stats.sorobanInclusionFee.p95)
      } catch { if (active) setStellarInclusionFee(null) }
    }
    void loadStellarFee()
    return () => { active = false }
  }, [config.stellarRpc])

  useEffect(() => {
    if (!window.ethereum || !evmAddress || !stellarAddress || !validAmount || feeStatus !== 'ready') {
      setSourceGas({ status: 'idle', approvalRequired: true, approvalCost: null, burnCost: null, nativeBalance: null })
      return
    }
    let active = true
    const estimateSourceGas = async () => {
      setSourceGas({ status: 'loading', approvalRequired: true, approvalCost: null, burnCost: null, nativeBalance: null })
      try {
        const provider = window.ethereum!
        const activeChain = Number.parseInt(await provider.request({ method: 'eth_chainId' }) as string, 16)
        if (activeChain !== source.chainId) throw new Error(`Switch to ${source.name} for a gas quote.`)
        const allowanceData = encodeFunctionData({ abi: erc20, functionName: 'allowance', args: [evmAddress as Hex, config.messenger] })
        const [allowanceHex, gasPriceHex, nativeBalanceHex] = await Promise.all([
          provider.request({ method: 'eth_call', params: [{ to: source.usdc, data: allowanceData }, 'latest'] }) as Promise<Hex>,
          provider.request({ method: 'eth_gasPrice' }) as Promise<Hex>,
          provider.request({ method: 'eth_getBalance', params: [evmAddress, 'latest'] }) as Promise<Hex>,
        ])
        const allowance = BigInt(allowanceHex)
        const gasPrice = BigInt(gasPriceHex)
        const approvalRequired = allowance < amountUnits
        let approvalCost: bigint | null = null
        let burnCost: bigint | null = null
        if (approvalRequired) {
          const approval = encodeFunctionData({ abi: erc20, functionName: 'approve', args: [config.messenger, amountUnits] })
          const approvalGas = BigInt(await provider.request({ method: 'eth_estimateGas', params: [{ from: evmAddress, to: source.usdc, data: approval }] }) as Hex)
          approvalCost = approvalGas * gasPrice
        } else {
          const forwarder = bytesToHex(StrKey.decodeContract(config.forwarder))
          const burn = encodeFunctionData({ abi: cctp, functionName: 'depositForBurnWithHook', args: [amountUnits, CCTP_DESTINATION_DOMAIN, forwarder, source.usdc, forwarder, maxProtocolFeeUnits, finalityThreshold, buildHookData(stellarAddress)] })
          const burnGas = BigInt(await provider.request({ method: 'eth_estimateGas', params: [{ from: evmAddress, to: config.messenger, data: burn }] }) as Hex)
          burnCost = burnGas * gasPrice
        }
        if (active) setSourceGas({ status: 'ready', approvalRequired, approvalCost, burnCost, nativeBalance: BigInt(nativeBalanceHex) })
      } catch (error) {
        if (active) setSourceGas({ status: 'error', approvalRequired: true, approvalCost: null, burnCost: null, nativeBalance: null, error: error instanceof Error ? error.message : 'Source gas estimate unavailable.' })
      }
    }
    void estimateSourceGas()
    return () => { active = false }
  }, [evmAddress, stellarAddress, validAmount, feeStatus, amountUnits, maxProtocolFeeUnits, finalityThreshold, source, config.forwarder, config.messenger])

  const switchEvmNetwork = async (target: Source) => {
    if (!window.ethereum) throw new Error('No EVM wallet was detected.')
    const chainId = `0x${target.chainId.toString(16)}`
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
    } catch (error) {
      const code = (error as { code?: number })?.code
      const details = TESTNET_WALLET_NETWORKS[target.chainId]
      if (!details || code !== 4902) throw error
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
        chainId,
        chainName: details.chainName,
        nativeCurrency: { name: details.symbol, symbol: details.symbol, decimals: details.decimals },
        rpcUrls: [details.rpc],
        blockExplorerUrls: [details.explorer],
      }] })
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
    }
  }

  const changeEnvironment = (next: Environment) => {
    if (next === environment) return
    const nextConfig = NETWORKS[next]
    setEnvironment(next)
    setSource(nextConfig.sources[0])
    setBalance(null); setBalanceStatus('idle'); setStellarUsdcBalance(null); setStellarXlmBalance(null); setStellarBalanceStatus('idle'); setAmount(''); setBurnHash(''); setRecipientToConfirm(''); setConfirmedMaxFee(null); setStellarPreparedFee(null); setStep('idle'); setFinality('standard')
    setNotice(`Switched to ${next === 'testnet' ? 'testnet' : 'mainnet'}. Reconnect or switch both wallets to the selected network.`)
  }

  const connectEvm = async () => {
    if (!window.ethereum) { setNotice('No EVM wallet was detected. Install or unlock MetaMask, Rabby, or another injected wallet.'); return }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      const id = await window.ethereum.request({ method: 'eth_chainId' }) as string
      if (Number.parseInt(id, 16) !== source.chainId) await switchEvmNetwork(source)
      setEvmAddress(accounts[0] ?? ''); setBalanceRefresh((value) => value + 1); setNotice('')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Wallet connection was cancelled.') }
  }

  const connectStellar = async () => {
    try {
      await setAllowed()
      const result = await requestAccess()
      if (result.error || !result.address) throw new Error(result.error?.message || 'No Stellar account was selected.')
      const recipient = result.address.trim()
      if (!isValidStellarRecipient(recipient)) throw new Error('Freighter returned an invalid Stellar address. Reconnect your wallet before continuing.')
      const network = await getNetwork()
      if (network.error || network.network !== config.stellarNetwork) throw new Error(`Switch Freighter to Stellar ${environment === 'testnet' ? 'Testnet' : 'Mainnet'} before continuing.`)
      setStellarAddress(recipient)
      setStellarNetwork(network.network)
      setStellarBalanceRefresh((value) => value + 1)
      setNotice('')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Stellar wallet connection was cancelled.') }
  }

  const verifyFreighterRecipient = async () => {
    const result = await getAddress()
    if (result.error || !result.address) throw new Error(result.error?.message || 'Freighter is locked or no longer connected.')
    const recipient = result.address.trim()
    if (!isValidStellarRecipient(recipient)) throw new Error('Freighter returned an invalid Stellar recipient. The bridge will not create a burn.')
    const network = await getNetwork()
    if (network.error || network.network !== config.stellarNetwork) throw new Error(`Freighter must be on Stellar ${environment === 'testnet' ? 'Testnet' : 'Mainnet'} before bridging.`)
    setStellarAddress(recipient)
    setStellarNetwork(network.network)
    return recipient
  }

  const selectSource = async (next: Source) => {
    setSource(next); setMenuOpen(false); setBalance(null); setBalanceStatus('idle'); setNotice('')
    if (!next.fast) setFinality('standard')
    if (!evmAddress || !window.ethereum) return
    try { await switchEvmNetwork(next); setBalanceRefresh((value) => value + 1) }
    catch { setNotice(`Switch your EVM wallet to ${next.name} before bridging.`) }
  }

  const sendTx = async (to: Hex, data: Hex) => {
    if (!window.ethereum || !evmAddress) throw new Error('Connect an EVM wallet first.')
    const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: evmAddress, to, data }] }) as string
    for (let tries = 0; tries < 120; tries += 1) {
      const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] }) as { status?: Hex } | null
      if (receipt) { if (receipt.status === '0x0') throw new Error('Transaction reverted.'); return hash }
      await sleep(1500)
    }
    throw new Error('Transaction confirmation timed out. Check your wallet activity.')
  }

  const getAttestation = async (hash: string) => {
    for (let tries = 0; tries < 180; tries += 1) {
      const response = await fetch(`${config.iris}/${source.domain}?transactionHash=${hash}`)
      if (response.ok) {
        const data = await response.json() as { messages?: Array<{ status: string; message: Hex; attestation: Hex }> }
        const message = data.messages?.[0]
        if (message?.status === 'complete') return message
      }
      await sleep(5000)
    }
    throw new Error('Attestation is still pending. Your burn is safe; return later with the transaction hash to resume.')
  }

  const mintAndForward = async (message: Hex, attestation: Hex, recipient: string) => {
    const server = new rpc.Server(config.stellarRpc)
    const account = await server.getAccount(recipient)
    let inclusionFee = 100n
    try {
      const stats = await server.getFeeStats()
      inclusionFee = BigInt(stats.sorobanInclusionFee.p95)
      if (inclusionFee < 100n) inclusionFee = 100n
    } catch { /* The network minimum remains a safe fallback outside surge periods. */ }
    const transaction = new TransactionBuilder(account, { fee: inclusionFee.toString(), networkPassphrase: config.stellarPassphrase })
      .addOperation(new Contract(config.forwarder).call('mint_and_forward', xdr.ScVal.scvBytes(hexToBytes(message)), xdr.ScVal.scvBytes(hexToBytes(attestation))))
      .setTimeout(120).build()
    const simulation = await server.simulateTransaction(transaction)
    if (rpc.Api.isSimulationError(simulation)) throw new Error('Stellar transaction simulation failed.')
    const prepared = rpc.assembleTransaction(transaction, simulation).build()
    setStellarPreparedFee(prepared.fee)
    setNotice(`Review the Stellar mint-and-forward transaction. Its maximum network fee is ${formatXlmStroops(prepared.fee)} XLM; unused refundable resource fees are returned.`)
    const signed = await signTransaction(prepared.toXDR(), { networkPassphrase: config.stellarPassphrase, address: recipient })
    if (signed.error || !signed.signedTxXdr) throw new Error(signed.error?.message || 'Stellar signature was rejected.')
    const result = await server.sendTransaction(TransactionBuilder.fromXDR(signed.signedTxXdr, config.stellarPassphrase))
    if (result.status === 'ERROR') throw new Error('Stellar transaction was rejected.')
  }

  const prepareBridge = async () => {
    try {
      const activeChain = Number.parseInt(await window.ethereum?.request({ method: 'eth_chainId' }) as string, 16)
      if (activeChain !== source.chainId) throw new Error(`Switch your EVM wallet to ${source.name} before bridging.`)
      if (!validAmount) throw new Error('Enter a valid transfer amount before continuing.')
      const liveBps = await fetchCircleFeeRate(config.iris, source.domain, finalityThreshold)
      const liveFee = calculateProtocolFee(amountUnits, liveBps)
      setFeeRateBps(liveBps)
      setFeeFetchedAt(Date.now())
      setFeeStatus('ready')
      setConfirmedMaxFee(addFeeBuffer(liveFee))
      const recipient = await verifyFreighterRecipient()
      setRecipientToConfirm(recipient)
      setNotice('Review the exact Stellar recipient before creating the irreversible CCTP burn.')
    } catch (error) { setStep('error'); setNotice(error instanceof Error ? error.message : 'Could not verify the recipient wallet.') }
  }

  const bridge = async (recipient: string) => {
    try {
      if (confirmedMaxFee === null) throw new Error('The Circle fee quote expired. Review a fresh quote before bridging.')
      const activeChain = Number.parseInt(await window.ethereum?.request({ method: 'eth_chainId' }) as string, 16)
      if (activeChain !== source.chainId) throw new Error(`Switch your EVM wallet to ${source.name} before bridging.`)
      const currentRecipient = await verifyFreighterRecipient()
      if (currentRecipient !== recipient) throw new Error('Freighter account changed after confirmation. Review the new recipient before burning.')
      const forwarder = bytesToHex(StrKey.decodeContract(config.forwarder))
      const hookData = buildHookData(recipient)
      if (decodeHookRecipient(hookData) !== recipient) throw new Error('The Stellar recipient changed while preparing CCTP hook data. No transaction was created.')
      const burn = encodeFunctionData({ abi: cctp, functionName: 'depositForBurnWithHook', args: [amountUnits, CCTP_DESTINATION_DOMAIN, forwarder, source.usdc, forwarder, confirmedMaxFee, finalityThreshold, hookData] })
      if (decodeRecipientFromBurnCalldata(burn) !== recipient) throw new Error('The final CCTP burn calldata does not contain the confirmed Stellar recipient. No transaction was created.')
      const allowanceData = encodeFunctionData({ abi: erc20, functionName: 'allowance', args: [evmAddress as Hex, config.messenger] })
      const allowance = BigInt(await window.ethereum!.request({ method: 'eth_call', params: [{ to: source.usdc, data: allowanceData }, 'latest'] }) as Hex)
      if (allowance < amountUnits) {
        setNotice('Approve the exact USDC transfer amount in your EVM wallet.'); setStep('approving')
        const approval = encodeFunctionData({ abi: erc20, functionName: 'approve', args: [config.messenger, amountUnits] })
        await sendTx(source.usdc, approval)
      }
      const latestBps = await fetchCircleFeeRate(config.iris, source.domain, finalityThreshold)
      const latestFee = calculateProtocolFee(amountUnits, latestBps)
      if (latestFee > confirmedMaxFee) throw new Error('Circle’s fee increased beyond the amount you reviewed. No USDC was burned; review the updated quote and try again.')
      setFeeRateBps(latestBps); setFeeFetchedAt(Date.now()); setFeeStatus('ready')
      const recipientBeforeBurn = await verifyFreighterRecipient()
      if (recipientBeforeBurn !== recipient) throw new Error('Freighter account changed before the burn. No CCTP burn was created.')
      try {
        const gasPrice = BigInt(await window.ethereum!.request({ method: 'eth_gasPrice' }) as Hex)
        const burnGas = BigInt(await window.ethereum!.request({ method: 'eth_estimateGas', params: [{ from: evmAddress, to: config.messenger, data: burn }] }) as Hex)
        setSourceGas((current) => ({ ...current, status: 'ready', burnCost: burnGas * gasPrice }))
        setNotice(`Recipient and fee verified. Estimated burn gas is ${formatTokenUnits(burnGas * gasPrice, nativeDecimals(source.chainId), 8)} ${nativeSymbol(source.chainId)} at the current gas price. Confirm the CCTP burn.`)
      } catch {
        setNotice('Recipient and fee verified. Review the wallet’s live gas quote, then confirm the CCTP burn.')
      }
      setStep('burning')
      const hash = await sendTx(config.messenger, burn)
      setBurnHash(hash); setStep('attesting'); setNotice('Circle is producing the CCTP attestation. This can take a few minutes.')
      const attestation = await getAttestation(hash)
      setStep('forwarding'); setNotice('Sign the Stellar mint-and-forward transaction in Freighter.')
      const recipientBeforeMint = await verifyFreighterRecipient()
      if (recipientBeforeMint !== recipient) throw new Error('Freighter account changed after the burn. Reconnect the original recipient wallet to complete the Stellar mint.')
      await mintAndForward(attestation.message, attestation.attestation, recipient)
      setStep('complete'); setStellarBalanceRefresh((value) => value + 1); setNotice('USDC has been minted and forwarded to your Stellar wallet.')
    } catch (error) { setStep('error'); setNotice(error instanceof Error ? error.message : 'Bridge could not be completed.') }
  }

  const sourceNativeSymbol = nativeSymbol(source.chainId)
  const sourceNativeDecimals = nativeDecimals(source.chainId)
  const knownSourceGas = exactSourceGasCost
  const sourceGasLabel = sourceGas.status === 'loading'
    ? 'Calculating…'
    : sourceGas.status === 'error'
      ? 'Unavailable'
      : sourceGas.status === 'ready' && sourceGas.approvalRequired && sourceGas.burnCost === null
        ? `${formatTokenUnits(knownSourceGas, sourceNativeDecimals, 8)} ${sourceNativeSymbol} approval + burn gas`
        : sourceGas.status === 'ready'
          ? `${formatTokenUnits(knownSourceGas, sourceNativeDecimals, 8)} ${sourceNativeSymbol}`
          : 'Connect wallets & enter amount'
  const stellarFeeLabel = stellarPreparedFee
    ? `${formatXlmStroops(stellarPreparedFee)} XLM max`
    : stellarInclusionFee
      ? `from ${formatXlmStroops(stellarInclusionFee)} XLM + resource fee`
      : 'Simulated before mint'

  return <main className="shell">
    <nav className="nav"><a className="brand" href="#top"><span className="brand-star">✦</span> lumen<span>bridge</span></a><div className="nav-right"><a href="https://developers.circle.com/cctp/quickstarts/transfer-usdc-stellar-arc" target="_blank" rel="noreferrer">CCTP docs ↗</a><div className="environment-switch" aria-label="Select network environment"><button className={environment === 'testnet' ? 'active test' : ''} onClick={() => changeEnvironment('testnet')}>Testnet</button><button className={environment === 'mainnet' ? 'active' : ''} onClick={() => changeEnvironment('mainnet')}>Mainnet</button></div></div></nav>
    <section className="hero" id="top"><p className="eyebrow">NATIVE USDC • CCTP V2</p><h1>Land your USDC<br /><em>on Stellar.</em></h1><p className="intro">A direct, non-custodial route from supported EVM networks to Stellar. Your funds are burned, attested by Circle, then minted as native Stellar USDC.</p>{environment === 'testnet' && <p className="testnet-callout"><b>Testnet mode</b> · Select any supported CCTP EVM testnet → Stellar Testnet</p>}</section>
    <section className="bridge-grid">
      <div className="bridge-card">
        <div className="card-top"><span>TRANSFER</span><span className="secure">● secured by Circle CCTP</span></div>
        <div className="route-block">
          <div className="route-label">FROM</div>
          <button className="network-picker" onClick={() => setMenuOpen(!menuOpen)}><span className={`token token-${source.short.toLowerCase()}`}>{source.logo}</span><span><b>{source.name}</b><small>Native USDC</small></span><span className="chevron">⌄</span></button>
          {menuOpen && <div className="network-menu">{config.sources.map((item) => <button key={item.chainId} className={item.chainId === source.chainId ? 'selected' : ''} onClick={() => void selectSource(item)}><span className={`token token-${item.short.toLowerCase()}`}>{item.logo}</span>{item.name}<small>{item.fast ? 'Standard + Fast' : 'Standard'} · Domain {item.domain}</small></button>)}</div>}
          <div className="wallet-balance" aria-live="polite"><span>AVAILABLE USDC</span><b>{balanceStatus === 'loading' ? 'Loading…' : balance !== null ? `${Number(formatUnits(balance, 6)).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC` : balanceStatus === 'error' ? 'Unavailable' : '—'}</b></div>
          <div className="amount-row"><input aria-label="Amount in USDC" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /><button disabled={balance === null} onClick={() => balance !== null && setAmount(formatUnits(balance, 6))}>MAX</button></div>
          <div className="balance">{balance !== null ? `Available in ${source.name}` : evmAddress ? 'Switch to the selected network to load its USDC balance' : 'Connect an EVM wallet to view balance'}</div>
        </div>
        <div className="route-line"><span className="route-dot"><i /></span><span /></div>
        <div className="route-block destination"><div className="route-label">TO</div><div className="network-picker static"><span className="token stellar">✦</span><span><b>Stellar</b><small>Native USDC • {environment === 'testnet' ? 'Testnet' : 'Mainnet'}</small></span><span className="route-lock">↗</span></div><div className="receive">Estimated to arrive <b>{feeStatus === 'ready' ? `${formatTokenUnits(estimatedReceiveUnits, 6, 6)} USDC` : '—'}</b><span>{feeStatus === 'loading' ? 'fetching Circle fee' : 'after CCTP fee'}</span></div></div>
        <fieldset className="mode" aria-label="Transfer speed">
          <legend>TRANSFER SPEED</legend>
          <button type="button" className={finality === 'standard' ? 'active' : ''} aria-pressed={finality === 'standard'} onClick={() => setFinality('standard')}><span className="mode-mark">◎</span><span><b>Standard transfer</b><small>Finalized confirmations · typically 0 CCTP fee</small></span><i>{finality === 'standard' ? 'SELECTED' : 'AVAILABLE'}</i></button>
          <button type="button" disabled={!source.fast} className={finality === 'fast' ? 'active fast' : 'fast'} aria-pressed={finality === 'fast'} onClick={() => source.fast && setFinality('fast')}><span className="mode-mark">ϟ</span><span><b>Fast transfer</b><small>{source.fast ? 'Faster attestation · live route fee' : `Not supported from ${source.name}`}</small></span><i>{!source.fast ? 'UNAVAILABLE' : finality === 'fast' ? 'SELECTED' : 'AVAILABLE'}</i></button>
        </fieldset>
        <div className="cost-card" aria-live="polite">
          <div className="cost-title"><span>LIVE COST ESTIMATE</span><span className={feeStatus === 'ready' ? 'quote-live' : 'quote-pending'}>{feeStatus === 'ready' ? '● LIVE' : feeStatus === 'loading' ? 'REFRESHING' : 'UNAVAILABLE'}</span></div>
          <div className="cost-row"><span>Circle {finality} fee<small>Deducted from destination USDC · {feeRateBps ?? '—'} bps</small></span><b>{feeStatus === 'ready' ? `${formatTokenUnits(protocolFeeUnits, 6, 6)} USDC` : '—'}</b></div>
          <div className="cost-row"><span>{source.name} gas<small>{sourceGas.approvalRequired ? 'Approval + burn · paid by EVM wallet' : 'Burn only · allowance already sufficient'}</small></span><b>{sourceGasLabel}</b></div>
          <div className="cost-row"><span>Stellar execution<small>Mint + forward · paid by Freighter in XLM{stellarXlmBalance !== null ? ` · balance ${Number(stellarXlmBalance).toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM` : ''}</small></span><b>{stellarFeeLabel}</b></div>
          <div className="cost-total"><span>Estimated receive<small>Gas is separate and never taken from this amount</small></span><b>{feeStatus === 'ready' ? `${formatTokenUnits(estimatedReceiveUnits, 6, 6)} USDC` : '—'}</b></div>
          {feeStatus === 'ready' && maxProtocolFeeUnits > protocolFeeUnits && <div className="fee-protection">Minimum under your buffered max fee: <b>{formatTokenUnits(minimumReceiveUnits, 6, 6)} USDC</b></div>}
          {sourceGas.nativeBalance !== null && <div className="gas-balance">Gas wallet balance: {formatTokenUnits(sourceGas.nativeBalance, sourceNativeDecimals, 8)} {sourceNativeSymbol}</div>}
          {sourceGasInsufficient && <div className="fee-error">The EVM wallet does not have enough {sourceNativeSymbol} for the current complete gas estimate.</div>}
          {feeStatus === 'error' && <div className="fee-error">{feeError} Transfers are paused until a verified quote is available.</div>}
          {feeFetchedAt && feeStatus === 'ready' && <div className="quote-time">Circle quote refreshed {new Date(feeFetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>}
        </div>
        {notice && <div className={`notice ${step === 'error' ? 'error' : step === 'complete' ? 'success' : ''}`}>{notice}{burnHash && <a href={`${source.explorer}${burnHash}`} target="_blank" rel="noreferrer"> View burn ↗</a>}</div>}
        <button className="bridge-button" disabled={!ready} onClick={() => void prepareBridge()}>{step === 'complete' ? 'Transfer complete' : ['approving', 'burning', 'attesting', 'forwarding'].includes(step) ? 'Transfer in progress…' : step === 'error' ? 'Verify recipient & try again' : !evmAddress ? 'Connect EVM wallet first' : !stellarAddress ? 'Connect Stellar wallet first' : amountUnits > MAX_BURN_UNITS ? 'Maximum transfer is 10,000,000 USDC' : !validAmount ? 'Enter a valid amount' : sourceGasInsufficient ? `Add ${sourceNativeSymbol} for gas` : feeStatus === 'loading' ? 'Loading live Circle fee…' : feeStatus === 'error' ? 'Fee quote unavailable' : `Bridge ${routeSummary}`}</button>
      </div>
      <aside className="side-panel"><div className="wallets"><div><p>YOUR WALLETS</p><h2>Two signatures.<br />One destination.</h2></div><button className={evmAddress ? 'wallet connected' : 'wallet'} onClick={() => void connectEvm()}><span className="wallet-icon eth">◆</span><span><b>{evmAddress ? clip(evmAddress) : 'EVM wallet'}</b><small>{evmAddress ? source.name : 'MetaMask, Rabby & more'}</small></span><i>{evmAddress ? '✓' : '↗'}</i></button><button className={stellarAddress ? 'wallet connected' : 'wallet'} onClick={() => void connectStellar()}><span className="wallet-icon stellar">✦</span><span><b>{stellarAddress ? clip(stellarAddress, 7, 5) : 'Stellar wallet'}</b><small>{stellarAddress ? (stellarNetwork || `Stellar ${environment === 'testnet' ? 'Testnet' : 'Mainnet'}`) : 'Connect Freighter'}</small></span><i>{stellarAddress ? '✓' : '↗'}</i></button>{stellarAddress && <div className="stellar-usdc-balance" aria-live="polite"><span>STELLAR USDC</span><b>{stellarBalanceStatus === 'loading' ? 'Loading…' : stellarUsdcBalance !== null ? `${Number(stellarUsdcBalance).toLocaleString(undefined, { maximumFractionDigits: 7 })} USDC` : 'Unavailable'}</b><small>{environment === 'testnet' ? 'Testnet trustline balance' : 'Mainnet trustline balance'}</small></div>}</div>
      <div className="flow"><p>THE CCTP PATH</p><div className="flow-step"><span>01</span><div><b>Approve & burn</b><small>USDC is burned on {source.name}</small></div></div><div className="flow-step"><span>02</span><div><b>Circle attests</b><small>Proof is generated by Iris</small></div></div><div className="flow-step"><span>03</span><div><b>Mint & forward</b><small>Native USDC lands on Stellar</small></div></div></div></aside>
    </section>
    <footer><span>Built for the native internet of value.</span><span>Non-custodial · No wrapped assets · <a href="https://developers.circle.com/cctp/references/stellar" target="_blank" rel="noreferrer">Forwarder protected ↗</a></span></footer>
    {recipientToConfirm && <div className="recipient-modal" role="dialog" aria-modal="true" aria-labelledby="recipient-title"><div className="recipient-dialog"><p className="eyebrow">FINAL RECIPIENT & FEE CHECK</p><h2 id="recipient-title">This address will receive your Stellar USDC.</h2><p>It is encoded permanently in the CCTP burn. Confirm the recipient and live fee protection before continuing.</p><div className="recipient-address"><span>CONNECTED FREIGHTER ADDRESS</span><code>{recipientToConfirm}</code></div><div className="modal-quote"><div><span>ESTIMATED RECEIVE</span><b>{formatTokenUnits(estimatedReceiveUnits, 6, 6)} USDC</b></div><div><span>CURRENT CIRCLE FEE</span><b>{formatTokenUnits(protocolFeeUnits, 6, 6)} USDC</b></div><div><span>MAX CIRCLE FEE</span><b>{formatTokenUnits(confirmedMaxFee ?? maxProtocolFeeUnits, 6, 6)} USDC</b></div><small>EVM and Stellar gas are paid separately by their respective wallets.</small></div><div className="recipient-actions"><button className="cancel" onClick={() => { setRecipientToConfirm(''); setConfirmedMaxFee(null) }}>Cancel</button><button className="confirm" onClick={() => { const recipient = recipientToConfirm; setRecipientToConfirm(''); void bridge(recipient) }}>Confirm recipient & bridge</button></div></div></div>}
  </main>
}

export default App
