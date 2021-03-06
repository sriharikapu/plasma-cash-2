import test from 'tape'
import BN from 'bn.js'
import Web3 from 'web3'
import { PlasmaUser } from 'loom-js'

import { increaseTime, getEthBalanceAtAddress } from './ganache-helpers'
import { sleep, ADDRESSES, ACCOUNTS, setupContracts } from './config'

export async function runRespondChallengeBeforeDemo(t: test.Test) {
  const web3Endpoint = 'ws://127.0.0.1:8545'
  const dappchainEndpoint = 'http://localhost:46658'
  const web3 = new Web3(new Web3.providers.WebsocketProvider(web3Endpoint))
  const { cards } = setupContracts(web3)

  const authority = PlasmaUser.createUser(
    web3Endpoint,
    ADDRESSES.root_chain,
    dappchainEndpoint,
    ACCOUNTS.authority
  )
  const dan = PlasmaUser.createUser(
    web3Endpoint,
    ADDRESSES.root_chain,
    dappchainEndpoint,
    ACCOUNTS.dan
  )
  const trudy = PlasmaUser.createUser(
    web3Endpoint,
    ADDRESSES.root_chain,
    dappchainEndpoint,
    ACCOUNTS.trudy
  )

  // Give Trudy 5 tokens
  await cards.registerAsync(trudy.ethAddress)
  let balance = await cards.balanceOfAsync(trudy.ethAddress)
  t.equal(balance.toNumber(), 5)

  const startBlockNum = await web3.eth.getBlockNumber()
  // Trudy deposits a coin
  await cards.depositToPlasmaAsync({ tokenId: 21, from: trudy.ethAddress })

  const deposits = await trudy.deposits()
  t.equal(deposits.length, 1, 'All deposit events accounted for')

  await sleep(8000)

  const plasmaBlock1 = await authority.submitPlasmaBlockAsync()
  const plasmaBlock2 = await authority.submitPlasmaBlockAsync()
  const deposit1Slot = deposits[0].slot

  // Trudy sends her coin to Dan
  const coin = await trudy.getPlasmaCoinAsync(deposit1Slot)
  await trudy.transferAsync(deposit1Slot, dan.ethAddress)

  // Operator includes it
  await authority.submitPlasmaBlockAsync()

  // Dan exits the coin received by Trudy
  await dan.exitAsync(deposit1Slot)
  const danExit = dan.watchChallenge(deposit1Slot, coin.depositBlockNum)

  // Trudy tries to challengeBefore Dan's exit
  await trudy.challengeBeforeAsync({
    slot: deposit1Slot,
    prevBlockNum: new BN(0),
    challengingBlockNum: coin.depositBlockNum
  })
  await sleep(2000)

  // Jump forward in time by 8 days
  await increaseTime(web3, 8 * 24 * 3600)

  await authority.finalizeExitsAsync()
  // Now that the exit has been finalized, stop watching challenges
  dan.stopWatching(danExit)

  await dan.withdrawAsync(deposit1Slot)

  const danBalanceBefore = await getEthBalanceAtAddress(web3, dan.ethAddress)
  await dan.withdrawBondsAsync()
  const danBalanceAfter = await getEthBalanceAtAddress(web3, dan.ethAddress)
  t.ok(danBalanceBefore.cmp(danBalanceAfter) < 0, 'END: Dan withdrew his bonds')

  const danTokensEnd = await cards.balanceOfAsync(dan.ethAddress)
  // Dan had initially 5 from when he registered and he received 2 coins
  // 1 in this demo and 1 in a previous one.
  t.equal(danTokensEnd.toNumber(), 7, 'END: Dan has correct number of tokens')

  // Close the websocket, hacky :/
  // @ts-ignore
  web3.currentProvider.connection.close()
  authority.disconnect()
  dan.disconnect()
  trudy.disconnect()

  t.end()
}
