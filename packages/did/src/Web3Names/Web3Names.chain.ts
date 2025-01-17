/**
 * Copyright 2018-2021 BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import {
  SubmittableExtrinsic,
  IDidIdentifier,
  Deposit,
  IDidDetails,
} from '@kiltprotocol/types'
import { BlockchainApiConnection } from '@kiltprotocol/chain-helpers'
import { DecoderUtils } from '@kiltprotocol/utils'

import type { Option, Bytes, Struct } from '@polkadot/types'
import type { AnyNumber } from '@polkadot/types/types'

import { DidUtils } from '../index.js'

/**
 * Web3NameOwner is a private interface for parsing the owner infos of a Web3Name from the on-chain format.
 */
interface Web3NameOwner extends Struct {
  owner: IDidIdentifier
  claimedAt: AnyNumber
  deposit: Deposit
}

/**
 *  Web3Name is the type of a nickname for a DID.
 */
export type Web3Name = string

/**
 * Returns a extrinsic to claim a new web3name.
 *
 * @param nick Web3Name that should be claimed.
 * @returns The [[SubmittableExtrinsic]] for the `claim` call.
 */
export async function getClaimTx(
  nick: Web3Name
): Promise<SubmittableExtrinsic> {
  const blockchain = await BlockchainApiConnection.getConnectionOrConnect()
  return blockchain.api.tx.web3Names.claim(nick)
}

/**
 * Returns a extrinsic to release a web3name by its owner.
 *
 * @returns The [[SubmittableExtrinsic]] for the `releaseByOwner` call.
 */
export async function getReleaseByOwnerTx(): Promise<SubmittableExtrinsic> {
  const blockchain = await BlockchainApiConnection.getConnectionOrConnect()
  return blockchain.api.tx.web3Names.releaseByOwner()
}

/**
 * Returns a extrinsic to release a web3name by the account that owns the deposit.
 *
 * @param nick Web3Name that should be released.
 * @returns The [[SubmittableExtrinsic]] for the `reclaimDeposit` call.
 */
export async function getReclaimDepositTx(
  nick: Web3Name
): Promise<SubmittableExtrinsic> {
  const blockchain = await BlockchainApiConnection.getConnectionOrConnect()
  return blockchain.api.tx.web3Names.reclaimDeposit(nick)
}

/**
 * Retrieve the Web3Name for a specific did identifier.
 *
 * @param didIdentifier DID identifier of the web3name owner, i.e. '4abc...'.
 * @returns The registered web3name for this DID if any.
 */
export async function queryWeb3NameForDidIdentifier(
  didIdentifier: IDidIdentifier
): Promise<Web3Name | null> {
  const blockchain = await BlockchainApiConnection.getConnectionOrConnect()
  const encoded = await blockchain.api.query.web3Names.names<Option<Bytes>>(
    didIdentifier
  )
  DecoderUtils.assertCodecIsType(encoded, ['Option<Bytes>'])
  return encoded.isSome ? encoded.unwrap().toUtf8() : null
}

/**
 * Retrieve the did identifier for a specific web3name.
 *
 * @param nick Web3Name that should be resolved to a DID.
 * @returns The DID identifier for this web3name if any.
 */
export async function queryDidIdentifierForWeb3Name(
  nick: Web3Name
): Promise<IDidIdentifier | null> {
  const blockchain = await BlockchainApiConnection.getConnectionOrConnect()
  const encoded = await blockchain.api.query.web3Names.owner<
    Option<Web3NameOwner>
  >(nick)
  DecoderUtils.assertCodecIsType(encoded, [
    'Option<PalletWeb3NamesWeb3NameWeb3NameOwnership>',
  ])

  return encoded.isSome ? encoded.unwrap().owner.toString() : null
}

/**
 * Retrieve the Web3Name for a specific did uri.
 *
 * @param did DID of the web3name owner, i.e. 'did:kilt:4abc...'.
 * @returns The registered web3name for this DID if any.
 */
export async function queryWeb3NameForDid(
  did: IDidDetails['did']
): Promise<Web3Name | null> {
  const details = DidUtils.parseDidUri(did)
  return queryWeb3NameForDidIdentifier(details.identifier)
}

/**
 * Retrieve the DID uri for a specific web3 name.
 *
 * @param nick Web3 name that should be looked up.
 * @returns The full DID uri, i.e. 'did:kilt:4abc...', if any.
 */
export async function queryDidForWeb3Name(
  nick: Web3Name
): Promise<string | null> {
  const identifier = await queryDidIdentifierForWeb3Name(nick)
  if (identifier === null) {
    return null
  }
  return DidUtils.getKiltDidFromIdentifier(identifier, 'full')
}
