/**
 * Copyright 2018-2021 BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

export * from './DidDetails'
export { getSignatureAlgForKeyType } from './DidDetails.utils'
export * from './LightDidDetails'
export {
  LightDidSupportedSigningKeyTypes,
  LightDidSupportedEncryptionKeyTypes,
  getDefaultMigrationHandler,
} from './LightDidDetails.utils'
export * from './FullDidDetails'
