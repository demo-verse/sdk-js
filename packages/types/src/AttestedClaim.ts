/**
 * Copyright 2018-2021 BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

/**
 * @packageDocumentation
 * @module IAttestedClaim
 */

import type { IAttestation, CompressedAttestation } from './Attestation'
import type {
  IRequestForAttestation,
  CompressedRequestForAttestation,
} from './RequestForAttestation'

export interface IAttestedClaim {
  attestation: IAttestation
  request: IRequestForAttestation
}

export type CompressedAttestedClaim = [
  CompressedRequestForAttestation,
  CompressedAttestation
]
