/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import useSWR from 'swr';

export interface GoogleAuthModelResult {
  isGoogleAuth: boolean;
}

export const useGoogleAuthModels = (): GoogleAuthModelResult => {
  const { data: googleConfig } = useSWR('google.config', () => configService.get('google.config'));
  const proxyKey = googleConfig?.proxy || '';

  // Check whether Google Auth CLI is ready.
  const { data: isGoogleAuth } = useSWR('google.auth.status' + proxyKey, async () => {
    const data = await ipcBridge.googleAuth.status.invoke({ proxy: googleConfig?.proxy });
    return data.success;
  });

  return {
    isGoogleAuth: Boolean(isGoogleAuth),
  };
};
