import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Message, Modal, Popconfirm, Select, Tabs, Typography } from '@arco-design/web-react';
import { Lock, Logout, Refresh, Save, User } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getBaseUrl, getWebuiGateHeaders, isRemoteClientBridgeMode } from '@/common/adapter/httpBridge';
import { normalizeVectorDbEndpoint } from '@/common/config/constants';
import { webui } from '@/common/adapter/ipcBridge';
import { configService } from '@/common/config/configService';
import { ADMIN_FRONTEND_USER_ID } from '@/common/utils/frontendUserScope';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { isElectronDesktop } from '@/renderer/utils/platform';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const { Text } = Typography;
const { TextArea } = Input;

type AccountProfile = {
  realName: string;
  bio: string;
  aiName: string;
  responseStyle: string;
  language: string;
  outputFormat: string;
  memoryNotes: string;
};

type LegacyAccountProfile = Partial<AccountProfile> & {
  displayName?: string;
  avatar?: string;
  department?: string;
  title?: string;
  responsibilities?: string;
  routineWork?: string;
};

type AccountProfileResponse = {
  user?: { id?: string; username?: string };
  profile?: LegacyAccountProfile;
  userMarkdown?: string;
  memoryMarkdown?: string;
  paths?: { user?: string; memory?: string };
};

type MemoryFileItem = {
  path: string;
  size?: number;
  updated_at?: string;
  source_agent?: string;
};

type JournalItem = {
  date: string;
  size?: number;
  updated_at?: string;
};

type MemoryFilesResponse = {
  files?: Array<{
    path?: string;
    rel_path?: string;
    source_path?: string;
    size?: number;
    updated_at?: string;
    source_agent?: string;
    metadata?: { rel_path?: string; path?: string; source_path?: string; source_agent?: string };
  }>;
};

type JournalsResponse = {
  journals?: JournalItem[];
};

type MemoryDocumentResponse = {
  content?: string;
  updated_at?: string;
};

const EMPTY_PROFILE: AccountProfile = {
  realName: '',
  bio: '',
  aiName: '',
  responseStyle: '',
  language: '',
  outputFormat: '',
  memoryNotes: '',
};

const PROFILE_BLOCK_RE = /<!-- centaurai-account-profile\n([\s\S]*?)\n-->/;

const shouldUseDirectVectorDb = (): boolean => isElectronDesktop() && !isRemoteClientBridgeMode();

const vectorEndpoint = (): string => normalizeVectorDbEndpoint(configService.get('vectorDB.endpoint'));

const safeUserPathSegment = (userId: string): string => encodeURIComponent(userId.trim()).replace(/%/g, '_');

const userMemoryRoot = (userId: string): string => `users/${safeUserPathSegment(userId)}`;

const userMemoryPath = (userId: string, file: 'USER.md' | 'MEMORY.md'): string => `${userMemoryRoot(userId)}/${file}`;

const encodeMemoryPath = (relPath: string): string => relPath.split('/').map(encodeURIComponent).join('/');

const profileFromMarkdown = (content: string): LegacyAccountProfile => {
  const match = PROFILE_BLOCK_RE.exec(content);
  if (!match?.[1]) return {};
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const profile: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') profile[key] = value;
    }
    return profile;
  } catch {
    return {};
  }
};

const memoryNotesFromMarkdown = (content: string): string =>
  content
    .replace(/^# .+$/m, '')
    .replace(/^## 需要长期记住的注意事项$/m, '')
    .replace(/^## Long-term notes$/m, '')
    .trim();

const mergeProfile = (profile?: LegacyAccountProfile, memoryMarkdown = ''): AccountProfile => {
  const legacyBio = [
    profile?.department ? `部门：${profile.department}` : '',
    profile?.title ? `职位：${profile.title}` : '',
    profile?.responsibilities ? `职责范围：${profile.responsibilities}` : '',
    profile?.routineWork ? `常处理业务：${profile.routineWork}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    ...EMPTY_PROFILE,
    realName: profile?.realName || profile?.displayName || '',
    bio: profile?.bio || legacyBio,
    aiName: profile?.aiName || '',
    responseStyle: profile?.responseStyle || '',
    language: profile?.language || '',
    outputFormat: profile?.outputFormat || '',
    memoryNotes: profile?.memoryNotes || memoryNotesFromMarkdown(memoryMarkdown),
  };
};

const line = (label: string, value: string): string => `- ${label}: ${value.trim()}`;

const buildUserMarkdown = (profile: AccountProfile, username: string): string => {
  const json = JSON.stringify(profile, null, 2);
  return [
    '# USER.md — 个人身份',
    '',
    '<!-- centaurai-account-profile',
    json,
    '-->',
    '',
    '## 账号信息',
    '',
    line('用户名', username),
    '',
    '## 工作身份',
    '',
    line('名称', profile.realName),
    '',
    '### 个人简介',
    '',
    profile.bio.trim(),
    '',
    '## AI 偏好',
    '',
    line('AI 称呼', profile.aiName),
    line('回答风格', profile.responseStyle),
    line('常用语言', profile.language),
    line('输出格式偏好', profile.outputFormat),
    '',
  ].join('\n');
};

const buildMemoryMarkdown = (profile: AccountProfile): string =>
  ['# MEMORY.md — 个人长期记忆', '', '## 需要长期记住的注意事项', '', profile.memoryNotes.trim(), ''].join('\n');

const normalizeMemoryFile = (file: NonNullable<MemoryFilesResponse['files']>[number]): MemoryFileItem | null => {
  const path = file.path || file.rel_path || file.metadata?.rel_path || file.metadata?.path || file.source_path;
  if (!path) return null;
  return {
    path,
    size: file.size,
    updated_at: file.updated_at,
    source_agent: file.source_agent || file.metadata?.source_agent,
  };
};

const memoryFilePriority = (path: string): number => {
  if (path.endsWith('/USER.md')) return 0;
  if (path.endsWith('/MEMORY.md')) return 1;
  return 2;
};

const normalizeMemoryFiles = (files: MemoryFilesResponse['files']): MemoryFileItem[] =>
  (files ?? [])
    .map(normalizeMemoryFile)
    .filter((file): file is MemoryFileItem => !!file)
    .toSorted((a, b) => memoryFilePriority(a.path) - memoryFilePriority(b.path) || a.path.localeCompare(b.path));

const personalMemoryFiles = (files: MemoryFileItem[], userId: string): MemoryFileItem[] => {
  const root = `${userMemoryRoot(userId)}/`;
  const journalRoot = `${root}journal/`;
  return files.filter(
    (file) => file.path.startsWith(root) && !file.path.startsWith(journalRoot) && file.path.endsWith('.md')
  );
};

const legacyRootMemoryFiles = (files: MemoryFileItem[]): MemoryFileItem[] =>
  files.filter((file) => {
    const path = file.path.replace(/\\/g, '/');
    return (
      path === 'USER.md' ||
      path === 'MEMORY.md' ||
      path === 'AGENTS.md' ||
      (path.startsWith('imports/') && path.endsWith('.md'))
    );
  });

const legacyRootJournals = (files: MemoryFileItem[]): JournalItem[] =>
  files
    .filter((file) => file.path.startsWith('journal/') && file.path.endsWith('.md'))
    .map((file) => ({
      date: journalDateFromPath(file.path),
      size: file.size,
      updated_at: file.updated_at,
    }))
    .filter((journal) => !!journal.date)
    .toSorted((a, b) => b.date.localeCompare(a.date));

const stripCurrentUserPrefix = (relPath: string, userId: string): string => {
  const root = `${userMemoryRoot(userId)}/`;
  return relPath.startsWith(root) ? relPath.slice(root.length) : relPath;
};

const memoryFileLabel = (relPath: string, userId: string): string => stripCurrentUserPrefix(relPath, userId);

const journalDateFromPath = (relPath: string): string => relPath.split('/').pop()?.replace(/\.md$/, '') ?? '';

async function readDirectMemoryFile(relPath: string, scope?: string): Promise<string> {
  const data = await webui.memoryRead.invoke({ endpoint: vectorEndpoint(), relPath, scope });
  return data.content ?? '';
}

async function listDirectMemoryFiles(scope?: string): Promise<MemoryFileItem[]> {
  const data = await webui.memoryList.invoke({ endpoint: vectorEndpoint(), scope });
  return normalizeMemoryFiles(data.files);
}

async function writeDirectMemoryFile(relPath: string, content: string): Promise<void> {
  await webui.memoryWrite.invoke({
    endpoint: vectorEndpoint(),
    relPath,
    content,
    sourceAgent: 'centaurai-account',
  });
}

async function deleteDirectMemoryFile(relPath: string): Promise<void> {
  await webui.memoryDelete.invoke({ endpoint: vectorEndpoint(), relPath });
}

const AccountSettings: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const authUser = auth.user;
  const currentUserId = authUser?.id ?? ADMIN_FRONTEND_USER_ID;
  const currentUsername = authUser?.username ?? 'admin';
  const directVector = shouldUseDirectVectorDb();

  const [profile, setProfile] = useState<AccountProfile>(EMPTY_PROFILE);
  const [paths, setPaths] = useState<{ user?: string; memory?: string }>({});
  const [memoryFiles, setMemoryFiles] = useState<MemoryFileItem[]>([]);
  const [selectedMemoryPath, setSelectedMemoryPath] = useState('');
  const [memoryFileContents, setMemoryFileContents] = useState<Record<string, string>>({});
  const [journals, setJournals] = useState<JournalItem[]>([]);
  const [selectedJournalDate, setSelectedJournalDate] = useState('');
  const [journalContents, setJournalContents] = useState<Record<string, string>>({});
  const [sharedMemoryFiles, setSharedMemoryFiles] = useState<MemoryFileItem[]>([]);
  const [selectedSharedMemoryPath, setSelectedSharedMemoryPath] = useState('');
  const [sharedMemoryFileContents, setSharedMemoryFileContents] = useState<Record<string, string>>({});
  const [sharedJournals, setSharedJournals] = useState<JournalItem[]>([]);
  const [selectedSharedJournalDate, setSelectedSharedJournalDate] = useState('');
  const [sharedJournalContents, setSharedJournalContents] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [memoryOverviewLoading, setMemoryOverviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const userPath = useMemo(() => userMemoryPath(currentUserId, 'USER.md'), [currentUserId]);
  const memoryPath = useMemo(() => userMemoryPath(currentUserId, 'MEMORY.md'), [currentUserId]);

  const languageOptions = useMemo(
    () => [
      t('settings.account.optionLanguageZhCN'),
      t('settings.account.optionLanguageZhTW'),
      t('settings.account.optionLanguageEnglish'),
      t('settings.account.optionLanguageAuto'),
    ],
    [t]
  );
  const responseStyleOptions = useMemo(
    () => [
      t('settings.account.optionStyleConcise'),
      t('settings.account.optionStyleDetailed'),
      t('settings.account.optionStyleFormal'),
      t('settings.account.optionStyleAction'),
    ],
    [t]
  );
  const outputFormatOptions = useMemo(
    () => [
      t('settings.account.optionFormatBullets'),
      t('settings.account.optionFormatTable'),
      t('settings.account.optionFormatSop'),
      t('settings.account.optionFormatReport'),
      t('settings.account.optionFormatMarkdown'),
    ],
    [t]
  );

  const readScopedMemoryFile = useCallback(
    async (relPath: string): Promise<string> => {
      if (directVector) return readDirectMemoryFile(relPath);
      const scopedPath = stripCurrentUserPrefix(relPath, currentUserId);
      const response = await fetch(
        `${getBaseUrl()}/api/memory/files/${encodeMemoryPath(scopedPath)}?endpoint=${encodeURIComponent(vectorEndpoint())}`,
        {
          cache: 'no-store',
          credentials: 'include',
          headers: getWebuiGateHeaders(),
        }
      );
      if (response.status === 404) return '';
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as MemoryDocumentResponse;
      return data.content ?? '';
    },
    [currentUserId, directVector]
  );

  const listScopedMemoryFiles = useCallback(async (): Promise<MemoryFileItem[]> => {
    if (directVector) {
      const files = await listDirectMemoryFiles();
      const scoped = personalMemoryFiles(files, currentUserId);
      return scoped.length > 0 ? scoped : legacyRootMemoryFiles(files);
    }
    const response = await fetch(`${getBaseUrl()}/api/memory/files?endpoint=${encodeURIComponent(vectorEndpoint())}`, {
      cache: 'no-store',
      credentials: 'include',
      headers: getWebuiGateHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as MemoryFilesResponse;
    return personalMemoryFiles(normalizeMemoryFiles(data.files), currentUserId);
  }, [currentUserId, directVector]);

  const listScopedJournals = useCallback(async (): Promise<JournalItem[]> => {
    if (directVector) {
      const files = await listDirectMemoryFiles();
      const journalRoot = `${userMemoryRoot(currentUserId)}/journal/`;
      const scoped = files
        .filter((file) => file.path.startsWith(journalRoot) && file.path.endsWith('.md'))
        .map((file) => ({
          date: journalDateFromPath(file.path),
          size: file.size,
          updated_at: file.updated_at,
        }))
        .filter((journal) => !!journal.date)
        .toSorted((a, b) => b.date.localeCompare(a.date));
      return scoped.length > 0 ? scoped : legacyRootJournals(files);
    }

    const response = await fetch(
      `${getBaseUrl()}/api/memory/journal?endpoint=${encodeURIComponent(vectorEndpoint())}`,
      {
        cache: 'no-store',
        credentials: 'include',
        headers: getWebuiGateHeaders(),
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as JournalsResponse;
    return (data.journals ?? []).toSorted((a, b) => b.date.localeCompare(a.date));
  }, [currentUserId, directVector]);

  const readScopedJournal = useCallback(
    async (date: string): Promise<string> => {
      if (directVector) return readDirectMemoryFile(`${userMemoryRoot(currentUserId)}/journal/${date}.md`);
      const response = await fetch(
        `${getBaseUrl()}/api/memory/journal/${encodeURIComponent(date)}?endpoint=${encodeURIComponent(vectorEndpoint())}`,
        {
          cache: 'no-store',
          credentials: 'include',
          headers: getWebuiGateHeaders(),
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as MemoryDocumentResponse;
      return data.content ?? '';
    },
    [currentUserId, directVector]
  );

  const listSharedMemoryFiles = useCallback(async (): Promise<MemoryFileItem[]> => {
    if (directVector) {
      return legacyRootMemoryFiles(await listDirectMemoryFiles('shared'));
    }
    const response = await fetch(
      `${getBaseUrl()}/api/memory/files?scope=shared&endpoint=${encodeURIComponent(vectorEndpoint())}`,
      {
        cache: 'no-store',
        credentials: 'include',
        headers: getWebuiGateHeaders(),
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as MemoryFilesResponse;
    return legacyRootMemoryFiles(normalizeMemoryFiles(data.files));
  }, [directVector]);

  const readSharedMemoryFile = useCallback(
    async (relPath: string): Promise<string> => {
      if (directVector) return readDirectMemoryFile(relPath, 'shared');
      const response = await fetch(
        `${getBaseUrl()}/api/memory/files/${encodeMemoryPath(relPath)}?scope=shared&endpoint=${encodeURIComponent(
          vectorEndpoint()
        )}`,
        {
          cache: 'no-store',
          credentials: 'include',
          headers: getWebuiGateHeaders(),
        }
      );
      if (response.status === 404) return '';
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as MemoryDocumentResponse;
      return data.content ?? '';
    },
    [directVector]
  );

  const listSharedJournals = useCallback(async (): Promise<JournalItem[]> => {
    if (directVector) return legacyRootJournals(await listDirectMemoryFiles('shared'));
    const response = await fetch(
      `${getBaseUrl()}/api/memory/journal?scope=shared&endpoint=${encodeURIComponent(vectorEndpoint())}`,
      {
        cache: 'no-store',
        credentials: 'include',
        headers: getWebuiGateHeaders(),
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as JournalsResponse;
    return (data.journals ?? []).toSorted((a, b) => b.date.localeCompare(a.date));
  }, [directVector]);

  const readSharedJournal = useCallback(
    async (date: string): Promise<string> => {
      if (directVector) return readDirectMemoryFile(`journal/${date}.md`, 'shared');
      const response = await fetch(
        `${getBaseUrl()}/api/memory/journal/${encodeURIComponent(date)}?scope=shared&endpoint=${encodeURIComponent(
          vectorEndpoint()
        )}`,
        {
          cache: 'no-store',
          credentials: 'include',
          headers: getWebuiGateHeaders(),
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as MemoryDocumentResponse;
      return data.content ?? '';
    },
    [directVector]
  );

  const loadMemoryOverview = useCallback(async () => {
    setMemoryOverviewLoading(true);
    try {
      const [files, nextJournals, sharedFiles, nextSharedJournals] = await Promise.all([
        listScopedMemoryFiles(),
        listScopedJournals(),
        listSharedMemoryFiles(),
        listSharedJournals(),
      ]);
      const nextMemoryPath = files[0]?.path ?? '';
      const nextJournalDate = nextJournals[0]?.date ?? '';
      const nextSharedMemoryPath = sharedFiles[0]?.path ?? '';
      const nextSharedJournalDate = nextSharedJournals[0]?.date ?? '';
      const [memoryContent, journalContent, sharedMemoryContent, sharedJournalContent] = await Promise.all([
        nextMemoryPath ? readScopedMemoryFile(nextMemoryPath) : Promise.resolve(''),
        nextJournalDate ? readScopedJournal(nextJournalDate) : Promise.resolve(''),
        nextSharedMemoryPath ? readSharedMemoryFile(nextSharedMemoryPath) : Promise.resolve(''),
        nextSharedJournalDate ? readSharedJournal(nextSharedJournalDate) : Promise.resolve(''),
      ]);
      setMemoryFiles(files);
      setSelectedMemoryPath(nextMemoryPath);
      setMemoryFileContents(nextMemoryPath ? { [nextMemoryPath]: memoryContent } : {});
      setJournals(nextJournals);
      setSelectedJournalDate(nextJournalDate);
      setJournalContents(nextJournalDate ? { [nextJournalDate]: journalContent } : {});
      setSharedMemoryFiles(sharedFiles);
      setSelectedSharedMemoryPath(nextSharedMemoryPath);
      setSharedMemoryFileContents(nextSharedMemoryPath ? { [nextSharedMemoryPath]: sharedMemoryContent } : {});
      setSharedJournals(nextSharedJournals);
      setSelectedSharedJournalDate(nextSharedJournalDate);
      setSharedJournalContents(nextSharedJournalDate ? { [nextSharedJournalDate]: sharedJournalContent } : {});
    } catch (error) {
      console.error('[AccountSettings] memory overview load failed:', error);
      Message.error(t('settings.account.memoryOverviewLoadFailed'));
    } finally {
      setMemoryOverviewLoading(false);
    }
  }, [
    listScopedJournals,
    listScopedMemoryFiles,
    listSharedJournals,
    listSharedMemoryFiles,
    readScopedJournal,
    readScopedMemoryFile,
    readSharedJournal,
    readSharedMemoryFile,
    t,
  ]);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      if (directVector) {
        const [userResult, memoryResult] = await Promise.allSettled([
          readDirectMemoryFile(userPath),
          readDirectMemoryFile(memoryPath),
        ]);
        const userContent = userResult.status === 'fulfilled' ? userResult.value : '';
        const memoryContent = memoryResult.status === 'fulfilled' ? memoryResult.value : '';
        const nextProfile = mergeProfile(profileFromMarkdown(userContent), memoryContent);
        setProfile(nextProfile);
        setPaths({ user: userPath, memory: memoryPath });
        await loadMemoryOverview();
        return;
      }

      const response = await fetch(
        `${getBaseUrl()}/api/account/profile?endpoint=${encodeURIComponent(vectorEndpoint())}`,
        {
          cache: 'no-store',
          credentials: 'include',
          headers: getWebuiGateHeaders(),
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as AccountProfileResponse;
      const nextProfile = mergeProfile(data.profile, data.memoryMarkdown ?? '');
      setProfile(nextProfile);
      setPaths(data.paths ?? { user: userPath, memory: memoryPath });
      await loadMemoryOverview();
    } catch (error) {
      console.error('[AccountSettings] load failed:', error);
      Message.error(t('settings.account.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [currentUsername, directVector, loadMemoryOverview, memoryPath, t, userPath]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const updateField = (key: keyof AccountProfile, value: string): void => {
    setProfile((prev) => {
      const next = { ...prev, [key]: value };
      return next;
    });
  };

  const saveProfile = async (): Promise<void> => {
    const nextUserMarkdown = buildUserMarkdown(profile, currentUsername);
    const nextMemoryMarkdown = buildMemoryMarkdown(profile);
    setSaving(true);
    try {
      if (directVector) {
        await Promise.all([
          writeDirectMemoryFile(userPath, nextUserMarkdown),
          writeDirectMemoryFile(memoryPath, nextMemoryMarkdown),
        ]);
      } else {
        const response = await fetch(`${getBaseUrl()}/api/account/profile`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...getWebuiGateHeaders() },
          body: JSON.stringify({
            endpoint: vectorEndpoint(),
            profile,
            userMarkdown: nextUserMarkdown,
            memoryMarkdown: nextMemoryMarkdown,
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
      Message.success(t('settings.account.saveSuccess'));
      await loadMemoryOverview();
    } catch (error) {
      console.error('[AccountSettings] save failed:', error);
      Message.error(t('settings.account.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const clearMemory = async (): Promise<void> => {
    setClearing(true);
    try {
      if (directVector) {
        await Promise.all([deleteDirectMemoryFile(userPath), deleteDirectMemoryFile(memoryPath)]);
      } else {
        const response = await fetch(
          `${getBaseUrl()}/api/account/memory?endpoint=${encodeURIComponent(vectorEndpoint())}`,
          {
            method: 'DELETE',
            credentials: 'include',
            headers: getWebuiGateHeaders(),
          }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
      setProfile(EMPTY_PROFILE);
      Message.success(t('settings.account.clearSuccess'));
      await loadMemoryOverview();
    } catch (error) {
      console.error('[AccountSettings] clear failed:', error);
      Message.error(t('settings.account.clearFailed'));
    } finally {
      setClearing(false);
    }
  };

  const changePassword = async (): Promise<void> => {
    if (newPassword.length < 6) {
      Message.warning(t('settings.account.passwordMinLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Message.warning(t('settings.account.passwordMismatch'));
      return;
    }
    setPasswordSaving(true);
    try {
      if (directVector) {
        await webui.changePassword.invoke({ newPassword });
      } else {
        const response = await fetch(`${getBaseUrl()}/api/account/change-password`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...getWebuiGateHeaders() },
          body: JSON.stringify({ new_password: newPassword }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
      Message.success(t('settings.account.passwordChanged'));
      setPasswordVisible(false);
      setNewPassword('');
      setConfirmPassword('');
      await auth.refresh();
    } catch (error) {
      console.error('[AccountSettings] password change failed:', error);
      Message.error(t('settings.account.passwordChangeFailed'));
    } finally {
      setPasswordSaving(false);
    }
  };

  const logout = async (): Promise<void> => {
    await auth.logout();
    void navigate('/login', { replace: true });
  };

  const selectMemoryPath = async (path: string): Promise<void> => {
    setSelectedMemoryPath(path);
    if (!path || memoryFileContents[path] !== undefined) return;
    try {
      const content = await readScopedMemoryFile(path);
      setMemoryFileContents((prev) => ({ ...prev, [path]: content }));
    } catch (error) {
      console.error('[AccountSettings] memory file load failed:', error);
      Message.error(t('settings.account.memoryOverviewLoadFailed'));
    }
  };

  const selectJournalDate = async (date: string): Promise<void> => {
    setSelectedJournalDate(date);
    if (!date || journalContents[date] !== undefined) return;
    try {
      const content = await readScopedJournal(date);
      setJournalContents((prev) => ({ ...prev, [date]: content }));
    } catch (error) {
      console.error('[AccountSettings] journal load failed:', error);
      Message.error(t('settings.account.memoryOverviewLoadFailed'));
    }
  };

  const selectSharedMemoryPath = async (path: string): Promise<void> => {
    setSelectedSharedMemoryPath(path);
    if (!path || sharedMemoryFileContents[path] !== undefined) return;
    try {
      const content = await readSharedMemoryFile(path);
      setSharedMemoryFileContents((prev) => ({ ...prev, [path]: content }));
    } catch (error) {
      console.error('[AccountSettings] shared memory file load failed:', error);
      Message.error(t('settings.account.memoryOverviewLoadFailed'));
    }
  };

  const selectSharedJournalDate = async (date: string): Promise<void> => {
    setSelectedSharedJournalDate(date);
    if (!date || sharedJournalContents[date] !== undefined) return;
    try {
      const content = await readSharedJournal(date);
      setSharedJournalContents((prev) => ({ ...prev, [date]: content }));
    } catch (error) {
      console.error('[AccountSettings] shared journal load failed:', error);
      Message.error(t('settings.account.memoryOverviewLoadFailed'));
    }
  };

  const textField = (
    key: keyof AccountProfile,
    labelKey: string,
    placeholderKey: string,
    rows?: number
  ): React.ReactNode => (
    <label className='flex flex-col gap-6px'>
      <span className='text-13px text-t-secondary'>{t(labelKey)}</span>
      {rows ? (
        <TextArea
          autoSize={{ minRows: rows, maxRows: rows + 2 }}
          value={profile[key]}
          placeholder={t(placeholderKey)}
          onChange={(value) => updateField(key, value)}
        />
      ) : (
        <Input value={profile[key]} placeholder={t(placeholderKey)} onChange={(value) => updateField(key, value)} />
      )}
    </label>
  );

  const selectField = (
    key: keyof AccountProfile,
    labelKey: string,
    placeholderKey: string,
    options: string[]
  ): React.ReactNode => (
    <label className='flex flex-col gap-6px'>
      <span className='text-13px text-t-secondary'>{t(labelKey)}</span>
      <Select
        allowClear
        allowCreate
        showSearch
        value={profile[key] || undefined}
        placeholder={t(placeholderKey)}
        onChange={(value) => updateField(key, typeof value === 'string' ? value : '')}
      >
        {options.map((option) => (
          <Select.Option key={option} value={option}>
            {option}
          </Select.Option>
        ))}
      </Select>
    </label>
  );

  const readonlyContent = (value: string, emptyKey: string): React.ReactNode =>
    value.trim() ? (
      <TextArea readOnly autoSize={{ minRows: 12, maxRows: 20 }} value={value} />
    ) : (
      <div className='min-h-220px rd-6px border border-dashed border-line px-12px py-12px text-13px text-t-tertiary'>
        {t(emptyKey)}
      </div>
    );

  const selectedMemoryContent = selectedMemoryPath ? (memoryFileContents[selectedMemoryPath] ?? '') : '';
  const selectedJournalContent = selectedJournalDate ? (journalContents[selectedJournalDate] ?? '') : '';
  const selectedSharedMemoryContent = selectedSharedMemoryPath
    ? (sharedMemoryFileContents[selectedSharedMemoryPath] ?? '')
    : '';
  const selectedSharedJournalContent = selectedSharedJournalDate
    ? (sharedJournalContents[selectedSharedJournalDate] ?? '')
    : '';

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px'>
        <div className='flex flex-wrap items-start justify-between gap-12px'>
          <div>
            <h2 className='m-0 text-20px font-600 text-t-primary'>{t('settings.account.title')}</h2>
            <p className='m-0 mt-4px text-13px text-t-secondary'>{t('settings.account.description')}</p>
          </div>
          <div className='flex flex-wrap items-center gap-8px'>
            <Button icon={<Refresh />} loading={loading || memoryOverviewLoading} onClick={loadProfile}>
              {t('common.refresh')}
            </Button>
            <Button type='primary' icon={<Save />} loading={saving} onClick={saveProfile}>
              {t('common.save')}
            </Button>
          </div>
        </div>

        <div className='border border-line rd-8px bg-2 px-16px py-14px'>
          <div className='flex flex-wrap items-center justify-between gap-12px'>
            <div className='flex min-w-0 items-center gap-10px'>
              <User theme='outline' size='22' className='text-primary shrink-0' />
              <div className='min-w-0'>
                <div className='text-14px font-600 text-t-primary truncate'>{currentUsername}</div>
                <Text className='text-12px text-t-tertiary break-all'>{currentUserId}</Text>
              </div>
            </div>
            <div className='flex flex-wrap items-center gap-8px'>
              <Button icon={<Lock />} onClick={() => setPasswordVisible(true)}>
                {t('settings.account.changePassword')}
              </Button>
              <Button icon={<Logout />} onClick={logout}>
                {t('settings.account.logout')}
              </Button>
            </div>
          </div>
        </div>

        <Tabs defaultActiveTab='identity'>
          <Tabs.TabPane key='identity' title={t('settings.account.identityTab')}>
            <div className='grid grid-cols-1 gap-14px'>
              {textField('realName', 'settings.account.realName', 'settings.account.realNamePlaceholder')}
              {textField('bio', 'settings.account.bio', 'settings.account.bioPlaceholder', 5)}
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane key='preferences' title={t('settings.account.preferencesTab')}>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-14px'>
              {textField('aiName', 'settings.account.aiName', 'settings.account.aiNamePlaceholder')}
              {selectField(
                'language',
                'settings.account.language',
                'settings.account.languagePlaceholder',
                languageOptions
              )}
              {selectField(
                'responseStyle',
                'settings.account.responseStyle',
                'settings.account.responseStylePlaceholder',
                responseStyleOptions
              )}
              {selectField(
                'outputFormat',
                'settings.account.outputFormat',
                'settings.account.outputFormatPlaceholder',
                outputFormatOptions
              )}
              <div className='md:col-span-2'>
                {textField('memoryNotes', 'settings.account.memoryNotes', 'settings.account.memoryNotesPlaceholder', 4)}
              </div>
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane key='memory' title={t('settings.account.memoryTab')}>
            <div className='flex flex-col gap-14px'>
              <div className='grid grid-cols-1 xl:grid-cols-2 gap-14px'>
                <section className='border border-line rd-8px px-14px py-14px'>
                  <div className='mb-10px flex flex-wrap items-center justify-between gap-10px'>
                    <div className='text-14px font-600 text-t-primary'>{t('settings.account.memoryFilesTitle')}</div>
                    <Button
                      size='small'
                      icon={<Refresh />}
                      loading={memoryOverviewLoading}
                      onClick={loadMemoryOverview}
                    >
                      {t('common.refresh')}
                    </Button>
                  </div>
                  {memoryFiles.length > 0 ? (
                    <Select value={selectedMemoryPath} onChange={(value) => void selectMemoryPath(String(value))}>
                      {memoryFiles.map((file) => (
                        <Select.Option key={file.path} value={file.path}>
                          {memoryFileLabel(file.path, currentUserId)}
                        </Select.Option>
                      ))}
                    </Select>
                  ) : (
                    <div className='mb-10px text-13px text-t-tertiary'>{t('settings.account.emptyMemoryFiles')}</div>
                  )}
                  <div className='mt-10px'>
                    {readonlyContent(selectedMemoryContent, 'settings.account.emptyMemoryFiles')}
                  </div>
                </section>
                <section className='border border-line rd-8px px-14px py-14px'>
                  <div className='mb-10px text-14px font-600 text-t-primary'>
                    {t('settings.account.autoJournalTitle')}
                  </div>
                  {journals.length > 0 ? (
                    <Select value={selectedJournalDate} onChange={(value) => void selectJournalDate(String(value))}>
                      {journals.map((journal) => (
                        <Select.Option key={journal.date} value={journal.date}>
                          {journal.date}
                        </Select.Option>
                      ))}
                    </Select>
                  ) : (
                    <div className='mb-10px text-13px text-t-tertiary'>{t('settings.account.emptyJournal')}</div>
                  )}
                  <div className='mt-10px'>
                    {readonlyContent(selectedJournalContent, 'settings.account.emptyJournal')}
                  </div>
                </section>
              </div>

              <section className='border border-line rd-8px px-14px py-14px'>
                <div className='mb-10px flex flex-wrap items-center justify-between gap-10px'>
                  <div>
                    <div className='text-14px font-600 text-t-primary'>团队共享记忆</div>
                    <div className='mt-2px text-12px text-t-tertiary'>普通 LAN 用户只读，管理员在用户管理或向量库记忆中心维护。</div>
                  </div>
                  <Button size='small' icon={<Refresh />} loading={memoryOverviewLoading} onClick={loadMemoryOverview}>
                    {t('common.refresh')}
                  </Button>
                </div>
                <div className='grid grid-cols-1 xl:grid-cols-2 gap-14px'>
                  <div>
                    {sharedMemoryFiles.length > 0 ? (
                      <Select
                        value={selectedSharedMemoryPath}
                        onChange={(value) => void selectSharedMemoryPath(String(value))}
                      >
                        {sharedMemoryFiles.map((file) => (
                          <Select.Option key={file.path} value={file.path}>
                            {file.path}
                          </Select.Option>
                        ))}
                      </Select>
                    ) : (
                      <div className='mb-10px text-13px text-t-tertiary'>暂无团队共享记忆</div>
                    )}
                    <div className='mt-10px'>{readonlyContent(selectedSharedMemoryContent, 'settings.account.emptyMemoryFiles')}</div>
                  </div>
                  <div>
                    {sharedJournals.length > 0 ? (
                      <Select
                        value={selectedSharedJournalDate}
                        onChange={(value) => void selectSharedJournalDate(String(value))}
                      >
                        {sharedJournals.map((journal) => (
                          <Select.Option key={journal.date} value={journal.date}>
                            {journal.date}
                          </Select.Option>
                        ))}
                      </Select>
                    ) : (
                      <div className='mb-10px text-13px text-t-tertiary'>暂无团队自动日记</div>
                    )}
                    <div className='mt-10px'>{readonlyContent(selectedSharedJournalContent, 'settings.account.emptyJournal')}</div>
                  </div>
                </div>
              </section>

              <div className='border border-line rd-8px px-16px py-14px'>
                <div className='flex flex-wrap items-center justify-between gap-12px'>
                  <div className='min-w-0'>
                    <div className='text-14px font-600 text-t-primary'>{t('settings.account.memoryControl')}</div>
                    <div className='mt-4px text-12px text-t-tertiary break-all'>
                      {paths.user || userPath} · {paths.memory || memoryPath}
                    </div>
                  </div>
                  <Popconfirm title={t('settings.account.clearConfirm')} onOk={clearMemory}>
                    <Button status='danger' loading={clearing}>
                      {t('settings.account.clearMemory')}
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            </div>
          </Tabs.TabPane>
        </Tabs>
      </div>

      <Modal
        visible={passwordVisible}
        title={t('settings.account.changePassword')}
        confirmLoading={passwordSaving}
        onOk={changePassword}
        onCancel={() => setPasswordVisible(false)}
      >
        <div className='flex flex-col gap-14px'>
          <label className='flex flex-col gap-6px'>
            <span className='text-13px text-t-secondary'>{t('settings.account.newPassword')}</span>
            <Input.Password value={newPassword} onChange={setNewPassword} />
          </label>
          <label className='flex flex-col gap-6px'>
            <span className='text-13px text-t-secondary'>{t('settings.account.confirmPassword')}</span>
            <Input.Password value={confirmPassword} onChange={setConfirmPassword} />
          </label>
        </div>
      </Modal>
    </SettingsPageWrapper>
  );
};

export default AccountSettings;
