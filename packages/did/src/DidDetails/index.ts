/**
 * Copyright 2018-2021 BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

export * from './DidDetails.js'
export { getSignatureAlgForKeyType } from './DidDetails.utils.js'
export * from './LightDidDetails.js'
export {
  LightDidSupportedSigningKeyTypes,
  LightDidSupportedEncryptionKeyTypes,
} from './LightDidDetails.utils.js'
export * from './FullDidDetails.js'
