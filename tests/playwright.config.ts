/**
 * Copyright 2018-2021 BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { PlaywrightTestConfig } from '@playwright/test'

const config: PlaywrightTestConfig = {
  globalTimeout: 80000, // Maximum time the whole test suite can run,
  timeout: 70000, // Timeout for each test
}

export default config