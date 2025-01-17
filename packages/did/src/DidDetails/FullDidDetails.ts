/**
 * Copyright 2018-2021 BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import type { Extrinsic } from '@polkadot/types/interfaces'
import { BN } from '@polkadot/util'

import type {
  DidKey,
  IDidIdentifier,
  IIdentity,
  KeyRelationship,
  KeystoreSigner,
  SubmittableExtrinsic,
} from '@kiltprotocol/types'

import { SDKErrors } from '@kiltprotocol/utils'

import type {
  DidCreationDetails,
  DidKeySelectionHandler,
  MapKeysToRelationship,
  PublicKeys,
  ServiceEndpoints,
} from '../types.js'
import { methodMapping } from './FullDidDetails.utils.js'
import { DidDetails } from './DidDetails.js'
import { getSignatureAlgForKeyType } from './DidDetails.utils.js'
import {
  generateDidAuthenticatedTx,
  queryDetails,
  queryNonce,
  queryServiceEndpoints,
} from '../Did.chain.js'
import {
  defaultDidKeySelection,
  FULL_DID_LATEST_VERSION,
  getKiltDidFromIdentifier,
} from '../Did.utils.js'

// Max nonce value is (2^64) - 1
const maxNonceValue = new BN(new BN(2).pow(new BN(64))).subn(1)

export class FullDidDetails extends DidDetails {
  public readonly identifier: IDidIdentifier

  /**
   * Create an instance of [[FullDidDetails]] with the provided details.
   * This is not to be used to create new DIDs, but it should only be used to serialize-deserialize full DID information to and from storage.
   * Creating an instance of a full DID in this way without writing the information on the blockchain, will render the DID useless.
   *
   * @param creationDetails The creation details.
   * @param creationDetails.identifier The DID subject identifier.
   * @param creationDetails.did The full DID identifier.
   * @param creationDetails.keys The set of public keys associated with the given full DID.
   * @param creationDetails.keyRelationships The map of key ID -> relationship (e.g., authentication, attestation).
   * @param creationDetails.serviceEndpoints The set of service endpoints controlled by the specified DID.
   */
  public constructor({
    identifier,
    did,
    keys,
    keyRelationships,
    serviceEndpoints = {},
  }: DidCreationDetails & { identifier: IDidIdentifier }) {
    super({ did, keys, keyRelationships, serviceEndpoints })

    this.identifier = identifier
  }

  /**
   * Create a new instance of [[FullDidDetails]] after fetching the relevant information from the blockchain.
   * Private keys are assumed to already live in the keystore to be used with this DID instance, as only the public keys are retrieved from the blockchain.
   *
   * @param didIdentifier The identifier of the DID to reconstruct.
   * @param version The version of the DID to recreate. It defaults to the latest version supported by the SDK.
   *
   * @returns The reconstructed [[FullDidDetails]], or null if not DID with the provided identifier exists.
   */
  public static async fromChainInfo(
    didIdentifier: IDidIdentifier,
    version: number = FULL_DID_LATEST_VERSION
  ): Promise<FullDidDetails | null> {
    const didRec = await queryDetails(didIdentifier)
    if (!didRec) return null

    const didUri = getKiltDidFromIdentifier(didIdentifier, 'full', version)

    const {
      publicKeys,
      assertionMethodKey,
      authenticationKey,
      capabilityDelegationKey,
      keyAgreementKeys,
    } = didRec

    const keys: PublicKeys = publicKeys.reduce((res, key) => {
      res[key.id] = key
      return res
    }, {})

    const keyRelationships: MapKeysToRelationship = {
      authentication: new Set([authenticationKey]),
      keyAgreement: new Set(keyAgreementKeys),
    }
    if (assertionMethodKey) {
      keyRelationships.assertionMethod = new Set([assertionMethodKey])
    }
    if (capabilityDelegationKey) {
      keyRelationships.capabilityDelegation = new Set([capabilityDelegationKey])
    }

    const serviceEndpoints: ServiceEndpoints = (
      await queryServiceEndpoints(didIdentifier)
    ).reduce((res, service) => {
      res[service.id] = service
      return res
    }, {})

    return new FullDidDetails({
      identifier: didIdentifier,
      did: didUri,
      keys,
      keyRelationships,
      serviceEndpoints,
    })
  }

  /**
   * Returns all the DID keys that could be used to sign the provided extrinsic for submission.
   * This function should never be used directly by SDK users, who should rather call [[FulLDidDetails.authorizeExtrinsic]].
   *
   * @param extrinsic The unsigned extrinsic to perform the lookup.
   *
   * @returns All the keys under the full DID that could be used to generate valid signatures to submit the provided extrinsic.
   */
  public getKeysForExtrinsic(extrinsic: Extrinsic): DidKey[] {
    const callMethod = extrinsic.method
    const { section, method } = callMethod
    const keyRelationship =
      methodMapping[section][method] ||
      methodMapping[section].default ||
      methodMapping.default.default
    return keyRelationship === 'paymentAccount'
      ? []
      : this.getKeys(keyRelationship)
  }

  /**
   * Returns the next nonce to use to sign a DID operation.
   * Normally, this function should not be called directly by SDK users. Nevertheless, in advanced cases where there might be race conditions, this function can be used as the basis on which to build parallel operation queues.
   *
   * @returns The next valid nonce, i.e., the nonce currently stored on the blockchain + 1, wrapping around the max value when reached.
   */
  public async getNextNonce(): Promise<BN> {
    const currentNonce = await queryNonce(this.identifier)
    // Wrap around the max u64 value when reached.
    // FIXME: can we do better than this? Maybe we could expose an RPC function for this, to keep it consistent over time.
    return currentNonce === maxNonceValue ? new BN(0) : currentNonce.addn(1)
  }

  /**
   * Signs and returns the provided unsigned extrinsic with the right DID key, if present. Otherwise, it will return an error.
   *
   * @param extrinsic The unsigned extrinsic to sign.
   * @param signer The keystore signer to use.
   * @param submitterAccount The KILT account to bind the DID operation to (to avoid MitM and replay attacks).
   * @param signingOptions The signing options.
   * @param signingOptions.keySelection The optional key selection logic, to choose the key among the set of allowed keys. By default it takes the first key from the set of valid keys.
   * @returns The DID-signed submittable extrinsic.
   */
  public async authorizeExtrinsic(
    extrinsic: Extrinsic,
    signer: KeystoreSigner,
    submitterAccount: IIdentity['address'],
    {
      keySelection = defaultDidKeySelection,
    }: {
      keySelection?: DidKeySelectionHandler
    } = {}
  ): Promise<SubmittableExtrinsic> {
    const signingKey = await keySelection(this.getKeysForExtrinsic(extrinsic))
    if (!signingKey) {
      throw SDKErrors.ERROR_DID_ERROR(
        `The details for did ${this.did} do not contain the required keys for this operation`
      )
    }
    return generateDidAuthenticatedTx({
      didIdentifier: this.identifier,
      signingPublicKey: signingKey.publicKey,
      alg: getSignatureAlgForKeyType(signingKey.type),
      signer,
      call: extrinsic,
      txCounter: await this.getNextNonce(),
      submitter: submitterAccount,
    })
  }

  /**
   * Signs and returns the provided unsigned extrinsic batch with the right DID key, if present. Otherwise, it will return an error.
   * The generated signature will fail to verify successfully by the blockchain if any two operations in the batch require a different key type, or if the key type specified is not the expected one for the operations in the batch.
   *
   * @param batchExtrinsic The unsigned extrinsic batch to sign.
   * @param signer The keystore signer to use.
   * @param submitterAccount The KILT account to bind the DID operation to (to avoid MitM and replay attacks).
   * @param keyRelationship The key relationship (e.g., authentication or attestation) to use when fetching the keys to use for signing the batch.
   * @param signingOptions The signing options.
   * @param signingOptions.keySelection The optional key selection logic, to choose the key among the set of allowed keys. By default it takes the first key from the set of valid keys.
   * @returns The DID-signed submittable extrinsic.
   */
  public async authorizeBatch(
    batchExtrinsic: Extrinsic,
    signer: KeystoreSigner,
    submitterAccount: IIdentity['address'],
    keyRelationship: KeyRelationship,
    {
      keySelection = defaultDidKeySelection,
    }: {
      keySelection?: DidKeySelectionHandler
    } = {}
  ): Promise<SubmittableExtrinsic> {
    const signingKey = await keySelection(this.getKeys(keyRelationship))
    if (
      batchExtrinsic.method.section !== 'utility' &&
      batchExtrinsic.method.method !== 'batch'
    ) {
      throw SDKErrors.ERROR_DID_ERROR(
        'authorizeBatch can only be used to sign utility.batch extrinsics.'
      )
    }
    if (!signingKey) {
      throw SDKErrors.ERROR_DID_ERROR(
        `The details for did ${this.did} do not contain the required keys for this operation`
      )
    }
    return generateDidAuthenticatedTx({
      didIdentifier: this.identifier,
      signingPublicKey: signingKey.publicKey,
      alg: getSignatureAlgForKeyType(signingKey.type),
      signer,
      call: batchExtrinsic,
      txCounter: await this.getNextNonce(),
      submitter: submitterAccount,
    })
  }
}
