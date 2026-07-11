/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IConversationTurnCompletedEvent, IDirOrFile, IResponseMessage } from '@/common/adapter/ipcBridge';
import { BUILTIN_IMAGE_GEN_ID } from '@/common/config/storage';
import { getFullAutoMode } from '@/common/types/agent/agentModes';
import {
  buildCliAgentParams,
  getDefaultAionrsModel,
} from '@/renderer/pages/conversation/utils/createConversationParams';
import {
  extractGeneratedArtifactPaths,
  notifyGeneratedArtifactsChanged,
  registerGeneratedArtifacts,
} from '@/renderer/utils/file/generatedArtifacts';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { buildToolPrompt, collectUploadPaths } from './toolboxPrompt';
import type {
  ToolDef,
  ToolFormValues,
  ToolImageResult,
  ToolRunLogEvent,
  ToolRunProgress,
  ToolRunResult,
} from './types';

/** Terminal wait for a run, in milliseconds. Image generation can be slow. */
const RUN_TIMEOUT_MS = 6 * 60 * 1000;
/** Max directory depth to scan for generated images. */
const MAX_SCAN_DEPTH = 2;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const DOCUMENT_EXT = /\.(pptx?|potx|pdf|docx?|xlsx?|csv|md)$/i;
const RUN_CANCELLED_ERROR = 'toolbox_run_cancelled';
const RUN_TIMEOUT_ERROR = 'run_timeout';
const MAX_RUN_EVENTS = 90;

type RunStatus = 'idle' | 'running' | 'done' | 'error';

export type UseToolboxRun = {
  status: RunStatus;
  result: ToolRunResult | null;
  progress: ToolRunProgress | null;
  events: ToolRunLogEvent[];
  error: string | null;
  run: (tool: ToolDef, agent: AgentMetadata | null, values: ToolFormValues) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
};

/** Recursively collect image files in a workspace, bounded by depth. */
async function scanImages(conversation_id: string, workspace: string, path: string, depth: number): Promise<string[]> {
  return scanFiles(conversation_id, workspace, path, depth, IMAGE_EXT);
}

async function scanDocuments(
  conversation_id: string,
  workspace: string,
  path: string,
  depth: number
): Promise<string[]> {
  return scanFiles(conversation_id, workspace, path, depth, DOCUMENT_EXT);
}

async function scanFiles(
  conversation_id: string,
  workspace: string,
  path: string,
  depth: number,
  matcher: RegExp
): Promise<string[]> {
  if (!workspace) return [];
  let nodes: IDirOrFile[];
  try {
    nodes = await ipcBridge.conversation.getWorkspace.invoke({ conversation_id, workspace, path });
  } catch {
    return [];
  }
  const found: string[] = [];
  const dirScans: Array<Promise<string[]>> = [];
  for (const node of nodes) {
    if (node.isFile && matcher.test(node.name)) {
      found.push(node.fullPath);
    } else if (node.isDir && depth < MAX_SCAN_DEPTH) {
      dirScans.push(scanFiles(conversation_id, workspace, node.fullPath, depth + 1, matcher));
    }
  }
  for (const nested of await Promise.all(dirScans)) found.push(...nested);
  return found;
}

function joinPath(base: string, name: string): string {
  return `${base.replace(/[\\/]+$/, '')}/${name.replace(/^[\\/]+/, '')}`;
}

function safeFileName(input: string): string {
  return (
    input
      .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 44) || 'AI产物'
  );
}

function padTimestamp(value: number): string {
  return String(value).padStart(2, '0');
}

function timestampLabel(): string {
  const now = new Date();
  return `${now.getFullYear()}${padTimestamp(now.getMonth() + 1)}${padTimestamp(now.getDate())}-${padTimestamp(now.getHours())}${padTimestamp(now.getMinutes())}`;
}

function titleCandidate(tool: ToolDef, values: ToolFormValues): string {
  for (const key of ['client', 'title', 'topic', 'name']) {
    const value = values[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return tool.titleText || tool.id;
}

async function createToolboxImageWorkspace(
  tool: ToolDef,
  values: ToolFormValues
): Promise<{ conversationId: string; workspace: string }> {
  const model = await getDefaultAionrsModel();
  const conversation = await ipcBridge.conversation.create.invoke({
    type: 'aionrs',
    name: safeFileName(`${tool.titleText || tool.id} ${titleCandidate(tool, values)}`).slice(0, 80),
    model,
    extra: {
      workspace: '',
      custom_workspace: false,
      selected_mcp_server_ids: [BUILTIN_IMAGE_GEN_ID],
      hidden_from_sidebar: true,
      workbench_id: tool.id,
      workbench_title: tool.titleText || tool.id,
      workbench_kind: tool.category,
    },
  });
  const workspace = (conversation?.extra as { workspace?: string } | undefined)?.workspace;
  if (!conversation?.id || !workspace) {
    throw new Error('workspace_create_failed');
  }
  return { conversationId: conversation.id, workspace };
}

function truncateLogText(value: string, length = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

function readTextField(value: unknown, keys: string[]): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === 'string' && field.trim()) return field.trim();
  }
  return '';
}

function stringifySmall(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function extractStreamText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return '';
  const direct = readTextField(data, ['content', 'text', 'message', 'description', 'subject', 'status', 'title']);
  if (direct) return direct;
  const record = data as Record<string, unknown>;
  const update = record.update;
  if (update && typeof update === 'object') {
    const updateText = readTextField(update, ['title', 'status', 'kind']);
    const rawInput = (update as Record<string, unknown>).rawInput;
    const command = readTextField(rawInput, ['command', 'cmd', 'description']);
    return [updateText, command].filter(Boolean).join(' · ');
  }
  const rawInput = record.rawInput ?? record.raw_input;
  const command = readTextField(rawInput, ['command', 'cmd', 'description']);
  return command || stringifySmall(data);
}

function summarizeStreamEvent(
  message: IResponseMessage,
  t: (key: string, options?: Record<string, unknown>) => string
): Omit<ToolRunLogEvent, 'id' | 'at'> | null {
  const text = truncateLogText(extractStreamText(message.data));
  switch (message.type) {
    case 'start':
      return {
        kind: 'agent',
        title: t('toolbox.runEvents.stream.agentStarted'),
        detail: t('toolbox.runEvents.stream.agentStartedDetail'),
      };
    case 'finish':
      return {
        kind: 'success',
        title: t('toolbox.runEvents.stream.agentFinished'),
        detail: t('toolbox.runEvents.stream.agentFinishedDetail'),
      };
    case 'agent_status':
      return text ? { kind: 'agent', title: t('toolbox.runEvents.stream.agentStatus'), detail: text } : null;
    case 'thought':
    case 'thinking':
      return text ? { kind: 'agent', title: t('toolbox.runEvents.stream.thinking'), detail: text } : null;
    case 'tool_call':
    case 'tool_group':
    case 'acp_tool_call':
      return text
        ? {
            kind: 'tool',
            title: t('toolbox.runEvents.stream.toolCall'),
            detail: text,
          }
        : { kind: 'tool', title: t('toolbox.runEvents.stream.toolCall') };
    case 'tips':
    case 'error':
      return text ? { kind: 'warning', title: t('toolbox.runEvents.stream.notice'), detail: text } : null;
    default:
      return null;
  }
}

async function persistTextOutput(
  tool: ToolDef,
  values: ToolFormValues,
  text: string,
  workspace: string,
  t: (key: string, options?: Record<string, unknown>) => string
): Promise<string[]> {
  const persistConfig =
    tool.persistTextOutput ??
    (tool.category === 'workbench' ? { fileNameSuffix: '工作台产物', title: tool.titleText || tool.id } : undefined);
  if (!persistConfig || !workspace || !text.trim()) return [];
  const baseName = safeFileName(`${titleCandidate(tool, values)}_${persistConfig.fileNameSuffix}`);
  const filePath = joinPath(workspace, `${baseName}_${timestampLabel()}.md`);
  const header = `> ${t('toolbox.runEvents.autoArchive', {
    title: persistConfig.title,
    time: new Date().toLocaleString(),
  })}\n\n`;
  const ok = await ipcBridge.fs.writeFile.invoke({ path: filePath, data: `${header}${text}` });
  if (!ok) return [];
  notifyGeneratedArtifactsChanged();
  return [filePath];
}

/**
 * Headless execution hook for the Common AI Toolbox.
 *
 * Creates a conversation for the chosen agent (in full-auto mode, with the
 * builtin image-generation MCP attached when the tool needs it), sends the
 * composed prompt, waits for the turn to finish, then collects any newly
 * generated images from the workspace for inline display. The created
 * conversation persists so the user can also open it in the normal chat view.
 * Workbench-category tools mark that backing conversation as hidden from the
 * sidebar; their saved files still surface through Workspace.
 */
export function useToolboxRun(): UseToolboxRun {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RunStatus>('idle');
  const [result, setResult] = useState<ToolRunResult | null>(null);
  const [progress, setProgress] = useState<ToolRunProgress | null>(null);
  const [events, setEvents] = useState<ToolRunLogEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const currentConversationIdRef = useRef<string | null>(null);
  const eventSeqRef = useRef(0);

  const appendEvent = useCallback((event: Omit<ToolRunLogEvent, 'id' | 'at'>) => {
    const nextEvent: ToolRunLogEvent = {
      ...event,
      id: `run-${Date.now()}-${eventSeqRef.current++}`,
      at: Date.now(),
    };
    setEvents((current) => [...current, nextEvent].slice(-MAX_RUN_EVENTS));
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setProgress(null);
    setEvents([]);
    setError(null);
    cancelRequestedRef.current = false;
  }, []);

  const cancel = useCallback(async () => {
    cancelRequestedRef.current = true;
    setProgress((current) => (current ? { ...current, label: t('toolbox.runEvents.progress.canceling') } : current));
    const conversationId = currentConversationIdRef.current;
    if (!conversationId) {
      return;
    }
    try {
      await ipcBridge.conversation.stop.invoke({ conversation_id: conversationId });
    } catch (cancelError) {
      console.warn('[Toolbox] stop request failed', cancelError);
    }
  }, [t]);

  const run = useCallback(
    async (tool: ToolDef, agent: AgentMetadata | null, values: ToolFormValues) => {
      if (runningRef.current) return;
      runningRef.current = true;
      cancelRequestedRef.current = false;
      currentConversationIdRef.current = null;
      setStatus('running');
      setResult(null);
      setProgress({ percent: 4, label: t('toolbox.runEvents.progress.preparingInput'), step: 1, total: 6 });
      setEvents([]);
      setError(null);

      const unsubscribers: Array<() => void> = [];
      let progressTimer: ReturnType<typeof setInterval> | null = null;
      const stopProgressTicker = () => {
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      };
      const startProgressTicker = (label: string, start: number, end: number, step: number, total: number) => {
        stopProgressTicker();
        setProgress({ percent: start, label, step, total });
        progressTimer = setInterval(() => {
          setProgress((current) => {
            const currentPercent = current?.percent ?? start;
            if (currentPercent >= end) return current ?? { percent: end, label, step, total };
            return { percent: Math.min(end, currentPercent + 3), label, step, total };
          });
        }, 1800);
      };
      try {
        const input = buildToolPrompt(tool, values);
        const files = collectUploadPaths(tool, values);
        appendEvent({
          kind: 'info',
          title: t('toolbox.runEvents.inputPrepared'),
          detail:
            files.length > 0
              ? t('toolbox.runEvents.inputPreparedWithFiles', { count: files.length })
              : t('toolbox.runEvents.inputPreparedNoFiles'),
        });
        if (cancelRequestedRef.current) throw new Error(RUN_CANCELLED_ERROR);

        const waitForConversationCompletion = (conversationId: string, timeoutMs = RUN_TIMEOUT_MS) =>
          new Promise<IConversationTurnCompletedEvent>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(RUN_TIMEOUT_ERROR)), timeoutMs);
            unsubscribers.push(
              ipcBridge.conversation.turnCompleted.on((event: IConversationTurnCompletedEvent) => {
                if (event.session_id !== conversationId) return;
                if (event.status === 'finished' || event.can_send_message === true) {
                  clearTimeout(timer);
                  resolve(event);
                }
              })
            );
          });

        const subscribeConversationStream = (conversationId: string) => {
          unsubscribers.push(
            ipcBridge.conversation.responseStream.on((message: IResponseMessage) => {
              if (message.conversation_id !== conversationId) return;
              const event = summarizeStreamEvent(message, t);
              if (event) appendEvent(event);
            })
          );
        };

        const sendConversationAndWait = async (
          conversationId: string,
          message: string,
          sendFiles: string[],
          timeoutMs = RUN_TIMEOUT_MS
        ) => {
          const completion = waitForConversationCompletion(conversationId, timeoutMs);
          const sent = ipcBridge.conversation.sendMessage.invoke({
            conversation_id: conversationId,
            input: message,
            files: sendFiles,
            ...(tool.injectSkills?.length ? { inject_skills: tool.injectSkills } : {}),
          });
          const sendFailure = sent.then(
            () => new Promise<IConversationTurnCompletedEvent>(() => {}),
            (sendError) => Promise.reject(sendError)
          );
          return Promise.race([completion, sendFailure]);
        };

        // Desktop can call the local MCP directly. WebUI/LAN browsers route
        // through a hidden conversation with the builtin image MCP attached.
        if (tool.requires === 'image-model') {
          setProgress({ percent: 18, label: t('toolbox.runEvents.progress.callingImageModel'), step: 2, total: 4 });
          appendEvent({
            kind: 'agent',
            title: t('toolbox.runEvents.callingImageModel'),
            detail: t('toolbox.runEvents.callingImageModelDetail'),
          });
          const runSpace = await createToolboxImageWorkspace(tool, values);
          currentConversationIdRef.current = runSpace.conversationId;
          appendEvent({
            kind: 'success',
            title: t('toolbox.runEvents.workspaceCreated'),
            detail: runSpace.conversationId,
          });
          if (cancelRequestedRef.current) {
            try {
              await ipcBridge.conversation.stop.invoke({ conversation_id: runSpace.conversationId });
            } catch (cancelError) {
              console.warn('[Toolbox] stop request failed', cancelError);
            }
            throw new Error(RUN_CANCELLED_ERROR);
          }
          const image_uris = files.length ? files : undefined;
          const rawCount = Number(values.count);
          const count = Number.isFinite(rawCount) ? Math.min(Math.max(Math.trunc(rawCount), 1), 4) : 1;

          if (!isElectronDesktop()) {
            subscribeConversationStream(runSpace.conversationId);
            startProgressTicker(t('toolbox.runEvents.progress.generatingImages'), 28, 78, 3, 4);
            appendEvent({
              kind: 'agent',
              title: t('toolbox.runEvents.sentToAgent'),
              detail: t('toolbox.runEvents.sentToAgentDesc'),
            });
            const lanPrompt =
              count > 1
                ? `${input}\n\nGenerate ${count} distinct images and save every generated image into the current workspace.`
                : input;
            const finished = await sendConversationAndWait(runSpace.conversationId, lanPrompt, files);
            if (cancelRequestedRef.current) throw new Error(RUN_CANCELLED_ERROR);
            stopProgressTicker();

            const lastContent = finished.last_message?.content;
            const finalText = typeof lastContent === 'string' ? lastContent : '';
            const workspace = finished.workspace || runSpace.workspace;
            setProgress({ percent: 84, label: t('toolbox.runEvents.progress.loadingResults'), step: 4, total: 4 });
            const scannedImages = await scanImages(runSpace.conversationId, workspace, workspace, 0);
            const mentionedPaths = extractGeneratedArtifactPaths(finalText);
            const registeredPaths = await registerGeneratedArtifacts({
              paths: [...scannedImages, ...mentionedPaths],
              workspace,
              conversationId: runSpace.conversationId,
              source: 'toolbox',
              standaloneLabel: '工具箱',
            });
            const imagePaths = registeredPaths.filter((path) => IMAGE_EXT.test(path));
            if (imagePaths.length === 0) {
              throw new Error('generation_failed');
            }
            const loaded = await Promise.all(
              imagePaths.map((path) =>
                ipcBridge.fs.getImageBase64
                  .invoke({ path, workspace })
                  .then((dataUrl) => (dataUrl ? { path, dataUrl } : null))
              )
            );
            const images = loaded.filter((item): item is ToolImageResult => item !== null);
            appendEvent({
              kind: 'success',
              title: t('toolbox.runEvents.imageGenerated'),
              detail: t('toolbox.runEvents.imageGeneratedDesc', { count: images.length }),
            });
            setResult({
              conversation_id: runSpace.conversationId,
              hiddenConversation: true,
              workspace,
              text: finalText,
              images,
              files: registeredPaths,
            });
            setProgress({ percent: 100, label: t('toolbox.runEvents.progress.done'), step: 4, total: 4 });
            setStatus('done');
            return;
          }

          startProgressTicker(t('toolbox.runEvents.progress.generatingImages'), 28, 78, 3, 4);

          const results = await Promise.all(
            Array.from({ length: count }, () =>
              ipcBridge.imageGen.generate.invoke({ prompt: input, image_uris, workspace: runSpace.workspace })
            )
          );
          const paths = results.filter((r) => r.success && r.imagePath).map((r) => r.imagePath as string);
          if (paths.length === 0) {
            throw new Error(results.find((r) => !r.success)?.error || 'generation_failed');
          }
          stopProgressTicker();
          setProgress({ percent: 84, label: t('toolbox.runEvents.progress.loadingResults'), step: 4, total: 4 });
          const loaded = await Promise.all(
            paths.map((path) =>
              ipcBridge.fs.getImageBase64.invoke({ path }).then((dataUrl) => (dataUrl ? { path, dataUrl } : null))
            )
          );
          const images = loaded.filter((item): item is ToolImageResult => item !== null);
          const registeredPaths = await registerGeneratedArtifacts({
            paths,
            workspace: runSpace.workspace,
            conversationId: runSpace.conversationId,
            source: 'toolbox',
            standaloneLabel: '工具箱',
          });
          appendEvent({
            kind: 'success',
            title: t('toolbox.runEvents.imageGenerated'),
            detail: t('toolbox.runEvents.imageGeneratedDesc', { count: images.length }),
          });
          setResult({
            conversation_id: runSpace.conversationId,
            hiddenConversation: true,
            workspace: runSpace.workspace,
            text: results.find((r) => r.text)?.text ?? '',
            images,
            files: registeredPaths,
          });
          setProgress({ percent: 100, label: t('toolbox.runEvents.progress.done'), step: 4, total: 4 });
          setStatus('done');
          return;
        }

        if (!agent) throw new Error('no_agent');
        const backend = agent.backend || agent.agent_type;
        const isWorkbenchRun = tool.category === 'workbench';

        setProgress({
          percent: 12,
          label: isWorkbenchRun
            ? t('toolbox.runEvents.progress.creatingWorkbench')
            : t('toolbox.runEvents.progress.creatingConversation'),
          step: 2,
          total: 6,
        });
        appendEvent({
          kind: 'info',
          title: isWorkbenchRun
            ? t('toolbox.runEvents.creatingWorkbench')
            : t('toolbox.runEvents.creatingConversation'),
          detail: t('toolbox.runEvents.executor', { name: agent.name || backend }),
        });
        const params = await buildCliAgentParams(agent, '');
        params.name = isWorkbenchRun
          ? safeFileName(`${tool.titleText || tool.id} ${titleCandidate(tool, values)}`).slice(0, 80)
          : input.slice(0, 40) || tool.id;
        params.extra.session_mode = getFullAutoMode(backend);
        if (isWorkbenchRun) {
          params.extra.hidden_from_sidebar = true;
          params.extra.workbench_id = tool.id;
          params.extra.workbench_title = tool.titleText || tool.id;
          params.extra.workbench_kind = tool.category;
        }

        const conversation = await ipcBridge.conversation.create.invoke(params);
        if (!conversation?.id) throw new Error('conversation_create_failed');
        const conversationId = conversation.id;
        currentConversationIdRef.current = conversationId;
        appendEvent({ kind: 'success', title: t('toolbox.runEvents.workspaceCreated'), detail: conversationId });
        if (cancelRequestedRef.current) {
          try {
            await ipcBridge.conversation.stop.invoke({ conversation_id: conversationId });
          } catch (cancelError) {
            console.warn('[Toolbox] stop request failed', cancelError);
          }
          throw new Error(RUN_CANCELLED_ERROR);
        }
        const initialWorkspace = (conversation.extra?.workspace as string | undefined) || '';

        // Snapshot pre-existing images so we only surface freshly generated ones.
        setProgress({ percent: 22, label: t('toolbox.runEvents.progress.preparingReferences'), step: 3, total: 6 });
        appendEvent({
          kind: 'info',
          title: t('toolbox.runEvents.baselineScanning'),
          detail: t('toolbox.runEvents.baselineScanningDesc'),
        });
        const baseline = new Set(await scanImages(conversationId, initialWorkspace, initialWorkspace, 0));
        const baselineDocuments = new Set(await scanDocuments(conversationId, initialWorkspace, initialWorkspace, 0));
        if (cancelRequestedRef.current) {
          try {
            await ipcBridge.conversation.stop.invoke({ conversation_id: conversationId });
          } catch (cancelError) {
            console.warn('[Toolbox] stop request failed', cancelError);
          }
          throw new Error(RUN_CANCELLED_ERROR);
        }

        subscribeConversationStream(conversationId);

        startProgressTicker(
          isWorkbenchRun
            ? t('toolbox.runEvents.progress.generatingWorkbench')
            : t('toolbox.runEvents.progress.generatingAgent'),
          34,
          76,
          4,
          6
        );
        appendEvent({
          kind: 'agent',
          title: t('toolbox.runEvents.sentToAgent'),
          detail: t('toolbox.runEvents.sentToAgentDesc'),
        });
        let finished: IConversationTurnCompletedEvent;
        finished = await sendConversationAndWait(conversationId, input, files);
        if (cancelRequestedRef.current) throw new Error(RUN_CANCELLED_ERROR);
        stopProgressTicker();

        let lastContent = finished.last_message?.content;
        let finalText = typeof lastContent === 'string' ? lastContent : '';

        let workspace = finished.workspace || initialWorkspace;
        setProgress({ percent: 82, label: t('toolbox.runEvents.progress.collectingResults'), step: 5, total: 6 });
        appendEvent({
          kind: 'file',
          title: t('toolbox.runEvents.resultScanning'),
          detail: t('toolbox.runEvents.resultScanningDesc'),
        });
        let allImages = await scanImages(conversationId, workspace, workspace, 0);
        let newImagePaths = allImages.filter((p) => !baseline.has(p));
        let allDocuments = await scanDocuments(conversationId, workspace, workspace, 0);
        let newDocumentPaths = allDocuments.filter((p) => !baselineDocuments.has(p));
        let mentionedDocumentPaths = extractGeneratedArtifactPaths(finalText);

        const loaded = await Promise.all(
          newImagePaths.map((path) =>
            ipcBridge.fs.getImageBase64
              .invoke({ path, workspace })
              .then((dataUrl) => (dataUrl ? { path, dataUrl } : null))
          )
        );
        const images: ToolImageResult[] = loaded.filter((item): item is ToolImageResult => item !== null);
        setProgress({ percent: 90, label: t('toolbox.runEvents.progress.savingContentHub'), step: 6, total: 6 });
        const artifactFiles = await persistTextOutput(tool, values, finalText, workspace, t);
        const resultFiles = await registerGeneratedArtifacts({
          paths: [...newImagePaths, ...newDocumentPaths, ...mentionedDocumentPaths, ...artifactFiles],
          workspace,
          conversationId,
          source: 'toolbox',
          standaloneLabel: '工具箱',
        });
        appendEvent({
          kind: resultFiles.length > 0 ? 'success' : 'warning',
          title: resultFiles.length > 0 ? t('toolbox.runEvents.resultCollected') : t('toolbox.runEvents.noFileResult'),
          detail:
            resultFiles.length > 0
              ? t('toolbox.runEvents.resultCollectedDesc', { count: resultFiles.length })
              : t('toolbox.runEvents.noFileResultDesc'),
        });

        setResult({
          conversation_id: conversationId,
          hiddenConversation: isWorkbenchRun,
          workspace,
          text: finalText,
          images,
          files: resultFiles,
        });
        setProgress({ percent: 100, label: t('toolbox.runEvents.progress.done'), step: 6, total: 6 });
        setStatus('done');
      } catch (e) {
        stopProgressTicker();
        if (e instanceof Error && e.message === RUN_CANCELLED_ERROR) {
          appendEvent({
            kind: 'warning',
            title: t('toolbox.runEvents.cancelled'),
            detail: t('toolbox.runEvents.cancelledDesc'),
          });
          setError(null);
          setProgress(null);
          setStatus('idle');
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
        appendEvent({
          kind: 'error',
          title: t('toolbox.runEvents.failed'),
          detail: e instanceof Error ? e.message : String(e),
        });
        setStatus('error');
      } finally {
        stopProgressTicker();
        unsubscribers.forEach((off) => off());
        runningRef.current = false;
        currentConversationIdRef.current = null;
        cancelRequestedRef.current = false;
      }
    },
    [appendEvent, t]
  );

  return { status, result, progress, events, error, run, cancel, reset };
}
