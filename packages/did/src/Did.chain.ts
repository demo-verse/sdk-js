/**
 * Copyright 2018-2021 BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import type {
  BTreeMap,
  BTreeSet,
  Enum,
  Option,
  Struct,
  Vec,
  u8,
  u64,
  GenericAccountId,
  Text,
  u128,
  u32,
} from '@polkadot/types'
import type {
  BlockNumber,
  Call,
  Extrinsic,
  Hash,
} from '@polkadot/types/interfaces'
import type { AnyNumber } from '@polkadot/types/types'
import { BN, hexToString, hexToU8a } from '@polkadot/util'

import type {
  Deposit,
  DidKey,
  DidServiceEndpoint,
  DidSignature,
  IDidIdentifier,
  IIdentity,
  KeystoreSigningOptions,
  SubmittableExtrinsic,
} from '@kiltprotocol/types'
import { ConfigService } from '@kiltprotocol/config'
import { KeyRelationship } from '@kiltprotocol/types'
import { BlockchainApiConnection } from '@kiltprotocol/chain-helpers'
import { Crypto, SDKErrors } from '@kiltprotocol/utils'

import { DidDetails, getSignatureAlgForKeyType } from './DidDetails/index.js'

const log = ConfigService.LoggingFactory.getLogger('Did')

// ### Chain type definitions

type KeyId = Hash
type DidKeyAgreementKeys = BTreeSet<KeyId>

type SupportedSignatureKeys = 'sr25519' | 'ed25519' | 'ecdsa'
type SupportedEncryptionKeys = 'x25519'

interface DidVerificationKey<T extends string = SupportedSignatureKeys>
  extends Enum {
  type: T
  value: Vec<u8>
}

interface DidEncryptionKey<T extends string = SupportedEncryptionKeys>
  extends Enum {
  type: T
  value: Vec<u8>
}

interface DidPublicKey extends Enum {
  isPublicVerificationKey: boolean
  asPublicVerificationKey: DidVerificationKey
  isPublicEncryptionKey: boolean
  asPublicEncryptionKey: DidEncryptionKey
  type: 'PublicVerificationKey' | 'PublicEncryptionKey'
  value: DidVerificationKey | DidEncryptionKey
}

interface DidPublicKeyDetails extends Struct {
  key: DidPublicKey
  blockNumber: BlockNumber
}

type DidPublicKeyMap = BTreeMap<KeyId, DidPublicKeyDetails>

interface IDidChainRecordCodec extends Struct {
  authenticationKey: KeyId
  keyAgreementKeys: DidKeyAgreementKeys
  delegationKey: Option<KeyId>
  attestationKey: Option<KeyId>
  publicKeys: DidPublicKeyMap
  lastTxCounter: u64
  deposit: Deposit
}

interface IServiceEndpointChainRecordCodec extends Struct {
  id: Text
  serviceTypes: Vec<Text>
  urls: Vec<Text>
}

// ### RAW QUERYING (lowest layer)

// Query a full DID given the identifier (a KILT address for v1).
// Interacts with the Did storage map.
async function queryDidEncoded(
  didIdentifier: IDidIdentifier
): Promise<Option<IDidChainRecordCodec>> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  return api.query.did.did<Option<IDidChainRecordCodec>>(didIdentifier)
}

// Query ALL deleted DIDs, which can be very time consuming if the number of deleted DIDs gets large.
async function queryDeletedDidsEncoded(): Promise<GenericAccountId[]> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  // Query all the storage keys, and then only take the relevant property, i.e., the encoded DID identifier.
  return api.query.did.didBlacklist
    .keys<GenericAccountId[]>()
    .then((entries) =>
      entries.map(({ args: [encodedDidIdentifier] }) => encodedDidIdentifier)
    )
}

// Query a DID service given the DID identifier and the service ID.
// Interacts with the ServiceEndpoints storage double map.
async function queryServiceEncoded(
  didIdentifier: IDidIdentifier,
  serviceId: string
): Promise<Option<IServiceEndpointChainRecordCodec>> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  return api.query.did.serviceEndpoints<
    Option<IServiceEndpointChainRecordCodec>
  >(didIdentifier, serviceId)
}

// Query all services for a DID given the DID identifier.
// Interacts with the ServiceEndpoints storage double map.
async function queryAllServicesEncoded(
  didIdentifier: IDidIdentifier
): Promise<IServiceEndpointChainRecordCodec[]> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  const encodedEndpoints = await api.query.did.serviceEndpoints.entries<
    Option<IServiceEndpointChainRecordCodec>
  >(didIdentifier)
  return encodedEndpoints.map(([, encodedValue]) => encodedValue.unwrap())
}

// Query the # of services stored under a DID without fetching all the services.
// Interacts with the DidEndpointsCount storage map.
async function queryEndpointsCountsEncoded(
  didIdentifier: IDidIdentifier
): Promise<u32> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  return api.query.did.didEndpointsCount<u32>(didIdentifier)
}

async function queryDepositAmountEncoded(): Promise<u128> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  return api.consts.did.deposit as u128
}

// ### DECODED QUERYING types

export type IChainDeposit = {
  owner: IIdentity['address']
  amount: BN
}

export type IDidChainRecordJSON = {
  authenticationKey: DidKey['id']
  keyAgreementKeys: Array<DidKey['id']>
  capabilityDelegationKey?: DidKey['id']
  assertionMethodKey?: DidKey['id']
  publicKeys: DidKey[]
  lastTxCounter: BN
  deposit: IChainDeposit
}

// ### DECODED QUERYING (builds on top of raw querying)

function decodeDidDeposit(encodedDeposit: Deposit): IChainDeposit {
  return {
    amount: new BN(encodedDeposit.amount.toString()),
    owner: encodedDeposit.owner.toString(),
  }
}

function decodeDidPublicKeyDetails(
  keyId: Hash,
  keyDetails: DidPublicKeyDetails
): DidKey {
  const key = keyDetails.key.value
  return {
    id: keyId.toHex(),
    type: key.type.toLowerCase(),
    publicKey: key.value.toU8a(),
    includedAt: keyDetails.blockNumber.toBn(),
  }
}

function decodeDidChainRecord(
  didDetail: IDidChainRecordCodec
): IDidChainRecordJSON {
  const publicKeys: DidKey[] = [...didDetail.publicKeys.entries()].map(
    ([keyId, keyDetails]) => {
      return decodeDidPublicKeyDetails(keyId, keyDetails)
    }
  )
  const authenticationKeyId = didDetail.authenticationKey.toHex()
  const keyAgreementKeyIds = [...didDetail.keyAgreementKeys.values()].map(
    (keyId) => {
      return keyId.toHex()
    }
  )

  const didRecord: IDidChainRecordJSON = {
    publicKeys,
    authenticationKey: authenticationKeyId,
    keyAgreementKeys: keyAgreementKeyIds,
    lastTxCounter: didDetail.lastTxCounter.toBn(),
    deposit: decodeDidDeposit(didDetail.deposit),
  }
  if (didDetail.delegationKey.isSome) {
    didRecord.capabilityDelegationKey = didDetail.delegationKey.unwrap().toHex()
  }
  if (didDetail.attestationKey.isSome) {
    didRecord.assertionMethodKey = didDetail.attestationKey.unwrap().toHex()
  }
  return didRecord
}

export async function queryDetails(
  didIdentifier: IDidIdentifier
): Promise<IDidChainRecordJSON | null> {
  const result = await queryDidEncoded(didIdentifier)
  if (result.isNone) {
    return null
  }
  return decodeDidChainRecord(result.unwrap())
}

// TODO: Find a better way to not decode the whole details struct to only fetch one key.
export async function queryKey(
  didIdentifier: IDidIdentifier,
  keyId: DidKey['id']
): Promise<DidKey | null> {
  const didDetails = await queryDetails(didIdentifier)
  if (!didDetails) {
    return null
  }
  return didDetails.publicKeys.find((key) => key.id === keyId) || null
}

function decodeServiceChainRecord(
  serviceDetails: IServiceEndpointChainRecordCodec
): DidServiceEndpoint {
  const id = hexToString(serviceDetails.id.toString())
  return {
    id,
    types: serviceDetails.serviceTypes.map((type) =>
      hexToString(type.toString())
    ),
    urls: serviceDetails.urls.map((url) => hexToString(url.toString())),
  }
}

export async function queryServiceEndpoints(
  didIdentifier: IDidIdentifier
): Promise<DidServiceEndpoint[]> {
  const encoded = await queryAllServicesEncoded(didIdentifier)
  return encoded.map((e) => decodeServiceChainRecord(e))
}

export async function queryServiceEndpoint(
  didIdentifier: IDidIdentifier,
  serviceId: DidServiceEndpoint['id']
): Promise<DidServiceEndpoint | null> {
  const serviceEncoded = await queryServiceEncoded(didIdentifier, serviceId)
  if (serviceEncoded.isNone) return null

  return decodeServiceChainRecord(serviceEncoded.unwrap())
}

export async function queryEndpointsCounts(
  didIdentifier: IDidIdentifier
): Promise<BN> {
  const endpointsCountEncoded = await queryEndpointsCountsEncoded(didIdentifier)
  return endpointsCountEncoded.toBn()
}

export async function queryNonce(didIdentifier: IDidIdentifier): Promise<BN> {
  const encoded = await queryDidEncoded(didIdentifier)
  return encoded.isSome ? encoded.unwrap().lastTxCounter.toBn() : new BN(0)
}

export async function queryDidDeletionStatus(
  didIdentifier: IDidIdentifier
): Promise<boolean> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  // The following function returns something different than 0x00 if there is an entry for the provided key, 0x00 otherwise.
  const encodedStorageHash = await api.query.did.didBlacklist.hash(
    didIdentifier
  )
  // isEmpty returns true if there is no entry for the given key -> the function should return false.
  return !encodedStorageHash.isEmpty
}

export async function queryDepositAmount(): Promise<BN> {
  const encodedDeposit = await queryDepositAmountEncoded()
  return encodedDeposit.toBn()
}

export async function queryDeletedDidIdentifiers(): Promise<IDidIdentifier[]> {
  const encodedIdentifiers = await queryDeletedDidsEncoded()
  return encodedIdentifiers.map((id) => id.toHuman())
}

// ### EXTRINSICS types

export type PublicKeyEnum = Record<string, Uint8Array>
export type SignatureEnum = Record<string, Uint8Array>

export type AuthorizeCallInput = {
  didIdentifier: IDidIdentifier
  txCounter: AnyNumber
  call: Extrinsic
  submitter: IIdentity['address']
  blockNumber?: AnyNumber
}

export type NewDidKey = Pick<DidKey, 'type' | 'publicKey'>

interface IDidAuthorizedCallOperation extends Struct {
  did: IDidIdentifier
  txCounter: u64
  call: Call
  submitter: GenericAccountId
  blockNumber: AnyNumber
}

// ### EXTRINSICS

function formatPublicKey(key: NewDidKey): PublicKeyEnum {
  const { type, publicKey } = key
  return { [type]: publicKey }
}

export async function generateCreateTxFromDidDetails(
  did: DidDetails,
  submitterAddress: IIdentity['address'],
  signingOptions: KeystoreSigningOptions
): Promise<SubmittableExtrinsic> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  const { signer, signingPublicKey, alg } = signingOptions

  const newKeyAgreementKeys: PublicKeyEnum[] = did
    .getKeys(KeyRelationship.keyAgreement)
    .map((key) => {
      return formatPublicKey(key)
    })

  // For now, it only takes the first attestation key, if present.
  const attestationKeys = did.getKeys(KeyRelationship.assertionMethod)
  if (attestationKeys.length > 1) {
    log.warn(
      `More than one attestation key (${attestationKeys.length}) specified. Only the first will be stored on the chain.`
    )
  }
  const newAttestationKey: PublicKeyEnum | undefined = attestationKeys[0]
    ? formatPublicKey(attestationKeys[0])
    : undefined

  // For now, it only takes the first delegation key, if present.
  const delegationKeys = did.getKeys(KeyRelationship.capabilityDelegation)
  if (delegationKeys.length > 1) {
    log.warn(
      `More than one delegation key (${delegationKeys.length}) specified. Only the first will be stored on the chain.`
    )
  }
  const newDelegationKey: PublicKeyEnum | undefined = delegationKeys[0]
    ? formatPublicKey(delegationKeys[0])
    : undefined

  const newServiceDetails = did.getEndpoints().map((service) => {
    const { id, urls } = service
    return { id, urls, serviceTypes: service.types }
  })

  const rawCreationDetails = {
    did: did.identifier,
    submitter: submitterAddress,
    newKeyAgreementKeys,
    newAttestationKey,
    newDelegationKey,
    newServiceDetails,
  }

  const encodedDidCreationDetails = api.registry.createType(
    api.tx.did.create.meta.args[0].type.toString(),
    rawCreationDetails
  )

  const signature = await signer.sign({
    data: encodedDidCreationDetails.toU8a(),
    meta: {},
    publicKey: Crypto.coToUInt8(signingPublicKey),
    alg,
  })
  return api.tx.did.create(encodedDidCreationDetails, {
    [signature.alg]: signature.data,
  })
}

export async function getSetKeyExtrinsic(
  keyRelationship: KeyRelationship,
  key: NewDidKey
): Promise<Extrinsic> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  const keyAsEnum = formatPublicKey(key)
  switch (keyRelationship) {
    case KeyRelationship.authentication:
      return api.tx.did.setAuthenticationKey(keyAsEnum)
    case KeyRelationship.capabilityDelegation:
      return api.tx.did.setDelegationKey(keyAsEnum)
    case KeyRelationship.assertionMethod:
      return api.tx.did.setAttestationKey(keyAsEnum)
    default:
      throw SDKErrors.ERROR_DID_ERROR(
        `setting a key is only allowed for the following key types: ${[
          KeyRelationship.authentication,
          KeyRelationship.capabilityDelegation,
          KeyRelationship.assertionMethod,
        ]}`
      )
  }
}

export async function getRemoveKeyExtrinsic(
  keyRelationship: KeyRelationship,
  keyId?: DidKey['id']
): Promise<Extrinsic> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  switch (keyRelationship) {
    case KeyRelationship.capabilityDelegation:
      return api.tx.did.removeDelegationKey()
    case KeyRelationship.assertionMethod:
      return api.tx.did.removeAttestationKey()
    case KeyRelationship.keyAgreement:
      if (!keyId) {
        throw SDKErrors.ERROR_DID_ERROR(
          `When removing a ${KeyRelationship.keyAgreement} key it is required to specify the id of the key to be removed.`
        )
      }
      return api.tx.did.removeKeyAgreementKey(keyId)
    default:
      throw SDKErrors.ERROR_DID_ERROR(
        `key removal is only allowed for the following key types: ${[
          KeyRelationship.keyAgreement,
          KeyRelationship.capabilityDelegation,
          KeyRelationship.assertionMethod,
        ]}`
      )
  }
}

export async function getAddKeyExtrinsic(
  keyRelationship: KeyRelationship,
  key: NewDidKey
): Promise<Extrinsic> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  const keyAsEnum = formatPublicKey(key)
  if (keyRelationship === KeyRelationship.keyAgreement) {
    return api.tx.did.addKeyAgreementKey(keyAsEnum)
  }
  throw SDKErrors.ERROR_DID_ERROR(
    `adding to the key set is only allowed for the following key types:  ${[
      KeyRelationship.keyAgreement,
    ]}`
  )
}

export async function getAddEndpointExtrinsic(
  endpoint: DidServiceEndpoint
): Promise<Extrinsic> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()

  return api.tx.did.addServiceEndpoint({
    serviceTypes: endpoint.types,
    ...endpoint,
  })
}

// The endpointId parameter is the service endpoint ID without the DID prefix.
// So for a endpoint of the form did:kilt:<identifier>#<endpoint_id>, only <endpoint_id> must be passed as parameter here.
export async function getRemoveEndpointExtrinsic(
  endpointId: DidServiceEndpoint['id']
): Promise<Extrinsic> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  return api.tx.did.removeServiceEndpoint(endpointId)
}

export async function getDeleteDidExtrinsic(
  endpointsCount: BN
): Promise<Extrinsic> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  return api.tx.did.delete(endpointsCount)
}

export async function getReclaimDepositExtrinsic(
  didIdentifier: IDidIdentifier,
  endpointsCount: BN
): Promise<SubmittableExtrinsic> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  return api.tx.did.reclaimDeposit(didIdentifier, endpointsCount)
}

// The block number can either be provided by the DID subject,
// or the latest one will automatically be fetched from the blockchain.
export async function generateDidAuthenticatedTx({
  didIdentifier,
  signingPublicKey,
  alg,
  signer,
  call,
  txCounter,
  submitter,
  blockNumber,
}: AuthorizeCallInput & KeystoreSigningOptions): Promise<SubmittableExtrinsic> {
  const { api } = await BlockchainApiConnection.getConnectionOrConnect()
  const signableCall = api.registry.createType<IDidAuthorizedCallOperation>(
    api.tx.did.submitDidCall.meta.args[0].type.toString(),
    {
      txCounter,
      did: didIdentifier,
      call,
      submitter,
      blockNumber: blockNumber || (await api.query.system.number()),
    }
  )
  const signature = await signer.sign({
    data: signableCall.toU8a(),
    meta: {
      method: call.method.toHex(),
      version: call.version,
      specVersion: api.runtimeVersion.specVersion.toString(),
      transactionVersion: api.runtimeVersion.transactionVersion.toString(),
      genesisHash: api.genesisHash.toHex(),
      nonce: signableCall.txCounter.toHex(),
      address: Crypto.encodeAddress(signableCall.did),
    },
    publicKey: Crypto.coToUInt8(signingPublicKey),
    alg,
  })
  return api.tx.did.submitDidCall(signableCall, {
    [signature.alg]: signature.data,
  })
}

// ### Chain utils
export function encodeDidSignature(
  key: Pick<DidKey, 'type'>,
  signature: Pick<DidSignature, 'signature'>
): SignatureEnum {
  const alg = getSignatureAlgForKeyType(key.type)
  if (!alg) {
    throw SDKErrors.ERROR_DID_ERROR(
      `The provided type ${key.type} does not match any known algorithm.`
    )
  }
  return {
    [alg]: hexToU8a(signature.signature),
  }
}
