/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import {
  contentAssetArchive,
  contentAssetPublishToNas,
  contentAssetsList,
  contentAssetSaveFromPath,
} from '@aionui/web-host';
import { ipcBridge } from '@/common';
import { getDataPath } from '../utils/utils';
import { resolveNasRootDir } from '../utils/webuiConfig';

function assetsDir(): string {
  return path.join(getDataPath(), 'contentAssets');
}

export function initContentAssetsBridge(): void {
  ipcBridge.contentAssetsLocal.list.provider(async ({ ownerUserId }) => contentAssetsList(assetsDir(), ownerUserId));

  ipcBridge.contentAssetsLocal.saveFromPath.provider(async (input) => contentAssetSaveFromPath(assetsDir(), input));

  ipcBridge.contentAssetsLocal.archive.provider(async ({ id, ownerUserId }) =>
    contentAssetArchive(assetsDir(), id, ownerUserId)
  );

  ipcBridge.contentAssetsLocal.publishToNas.provider(async ({ id, ownerUserId, userLabel, conversationLabel }) => {
    const nasRoot = await resolveNasRootDir();
    if (!nasRoot) return null;
    return contentAssetPublishToNas(assetsDir(), nasRoot, id, { userLabel, conversationLabel }, ownerUserId);
  });
}
