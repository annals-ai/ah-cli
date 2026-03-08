import * as React from 'react';

export type LanguagePreference = 'system' | 'en' | 'zh';
export type ResolvedLanguage = 'en' | 'zh';

type TranslationParams = Record<string, string | number>;
type TranslationLeaf = string | ((params: TranslationParams) => string);
type TranslationTree = {
  [key: string]: TranslationLeaf | TranslationTree;
};

const LANGUAGE_STORAGE_KEY = 'agent-mesh.ui.language';

const messages: Record<ResolvedLanguage, TranslationTree> = {
  en: {
    common: {
      auto: 'Auto',
      english: 'English',
      chinese: '简体中文',
      language: 'Language',
      theme: 'Theme',
      system: 'System',
      light: 'Light',
      dark: 'Dark',
      jump: 'Jump',
      refreshSnapshot: 'Refresh snapshot',
      refreshingSnapshot: 'Refreshing snapshot...',
      offline: 'offline',
      localOnly: 'Local only',
      neverSynced: 'Never synced',
      cancel: 'Cancel',
      close: 'Close',
      saveBinding: 'Save binding',
      saving: 'Saving...',
      createAgent: 'Create agent',
      creatingAgent: 'Creating...',
      saveChanges: 'Save changes',
      searchTranscript: 'Search transcript',
      agent: 'Agent',
      taskGroup: 'Task group',
      message: 'Message',
      send: 'Send',
      sending: 'Sending...',
      forkTitle: 'Fork title',
      action: 'Action',
      archive: 'Archive',
      archiving: 'Archiving...',
      stop: 'Stop',
      stopping: 'Stopping...',
      forkSession: 'Fork session',
      forkingSession: 'Forking...',
      metadata: 'Metadata',
      noMessageContent: '(No message content)',
      name: 'Name',
      slug: 'Slug',
      runtime: 'Runtime',
      visibility: 'Visibility',
      projectPath: 'Project path',
      capabilities: 'Capabilities',
      description: 'Description',
      provider: 'Provider',
      configJson: 'Config JSON',
      edit: 'Edit',
      expose: 'Expose',
      remove: 'Remove',
      configure: 'Configure',
      disable: 'Disable',
      filterSessions: 'Filter sessions',
      showingSessions: 'Showing sessions',
      sandboxOn: 'Sandbox on',
      sandboxOff: 'Sandbox off',
      providerBindings: ({ count }) => `${count} provider bindings`,
      sessionsCount: ({ count }) => `${count} sessions`,
      createFirstAgent: 'Create the first agent here, then use provider bindings when you are ready to expose it.',
      noProviderExposure: 'No provider exposure configured yet.',
      noProvidersAvailable: 'No providers available',
      closeDialog: 'Close',
    },
    app: {
      alert: 'Alert',
      snapshotRefreshFailed: 'Snapshot refresh failed',
      loading: 'Loading',
      collectingState: 'Collecting local daemon state',
      fetchingState: 'Fetching agents, sessions, tasks, providers, and recent logs.',
    },
    shell: {
      localConsole: 'Local Console',
      description:
        'A local operations desk for daemon health, registered agents, session history, provider exposure, and recent runtime activity.',
      uiOrigin: 'UI origin',
      daemonStart: 'Daemon start',
      nav: {
        overview: 'Overview',
        agents: 'Agents',
        sessions: 'Sessions',
        transcript: 'Transcript',
        tasks: 'Tasks',
        exposure: 'Exposure',
        logs: 'Logs',
      },
    },
    overview: {
      title: 'Daemon pressure and local history at a glance',
      description: 'Keep the UI endpoint, queue pressure, and runtime activity visible while you inspect the local registry.',
      uiEndpoint: 'UI endpoint',
      port: ({ port }) => `Port ${port}`,
      bindingsLabel: 'Provider bindings',
      agentsDetail: 'Tracked in the local daemon registry',
      sessionsDetail: 'Full transcript history stays local',
      tasksDetail: 'Cross-agent bundles and workstreams',
      bindingsDetail: 'Exposure points and gateway sync state',
      queueLoad: 'Queue load',
      activeCount: ({ count }) => `${count} active`,
      queuedCount: ({ count }) => `${count} queued`,
      managedSessions: 'Managed sessions',
      streamingCount: ({ count }) => `${count} currently streaming`,
      concurrencyBudget: 'Concurrency budget',
      queueWindowMinutes: ({ count }) => `${count} min queue window`,
      queueWindowHours: ({ count }) => `${count} hr queue window`,
      trackedAgents: ({ count }) => `${count} tracked agents`,
      providerBindings: ({ count }) => `${count} provider bindings`,
      activeExecutions: ({ count }) => `${count} active executions`,
      taskGroups: ({ count }) => `${count} task groups`,
    },
    agents: {
      title: 'Runtime roster',
      description: 'Monitor local agents, filter their sessions, and manage provider bindings without leaving the console.',
      emptyTitle: 'No local agents registered',
      editTitle: 'Edit agent',
      createTitle: 'Create agent',
      formDescription: 'Register a local daemon-owned agent or update its runtime metadata.',
      nameRequired: 'Name and project path are required.',
      slugPlaceholder: 'optional',
      projectPathPlaceholder: '/absolute/path/to/project',
      capabilitiesPlaceholder: 'search, code, review',
      descriptionPlaceholder: 'What this local agent is responsible for...',
      sandboxLabel: 'Enable sandbox / workspace isolation for this agent',
      exposeTitle: 'Expose provider',
      exposeDescription: ({ agent }) => `Connect ${agent} to a local or remote provider binding.`,
      chooseProvider: 'Choose a provider.',
      invalidConfigJson: 'Config JSON is invalid.',
      providerPlaceholder: 'Choose provider',
      removeConfirm: ({ name }) => `Remove agent "${name}"?`,
      disableConfirm: ({ provider }) => `Disable ${provider} for this agent?`,
      remoteFallback: 'Local only',
      noDescriptionFallback: 'No description provided.',
    },
    sessions: {
      title: 'Live desk',
      description: 'Filter by agent, task group, or lifecycle state without losing your selected session.',
      agentFilter: 'Agent',
      allAgents: 'All agents',
      taskGroupFilter: 'Task group',
      allTaskGroups: 'All task groups',
      statusFilter: 'Status',
      emptyTitle: 'No sessions match the current filters',
      emptyDescription: 'Try another agent, task group, or lifecycle slice to reveal matching sessions.',
      untitled: 'Untitled session',
      taskLinked: 'Task linked',
      standalone: 'Standalone',
      tagsCount: ({ count }) => `${count} tags`,
    },
    transcript: {
      title: 'Transcript',
      emptySession: 'Select a session',
      description: 'Inspect local user, assistant, system, and tool events without leaving the daemon console.',
      startTitle: 'Start a new session',
      startDescription: 'Pick a local agent, optionally link a task group, and send the first operator message.',
      continueTitle: 'Continue this session',
      continueDescription: 'Send the next local turn into the selected session without leaving the dashboard.',
      startPlaceholder: 'Ask the agent to inspect, plan, or act...',
      replyPlaceholder: 'Send the next local turn...',
      startSession: 'Start session',
      sendReply: 'Send reply',
      noTaskGroup: 'No task group',
      noAgentsAvailable: 'Create an agent first',
      selectAgentRequired: 'Select an agent before starting a new session.',
      searchPlaceholder: 'Search content, roles, kinds, metadata...',
      forkPlaceholder: 'Experiment',
      pickSessionTitle: 'Pick a session from the desk',
      pickSessionDescription: 'The transcript viewer shows every local message, including tool and system events.',
      loadingTitle: 'Loading transcript...',
      loadingDescription: 'Pulling local history from the daemon.',
      loadFailed: 'Transcript load failed',
      noMatchTitle: 'No messages match the current search',
      noMatchDescription: 'Clear the query to inspect the full session stream.',
      scrollToBottom: 'Scroll to bottom',
    },
    tasks: {
      title: 'Task group watchlist',
      description: 'Grouped sessions, owner source metadata, and current task lifecycle all in one place.',
      createTask: 'Create task group',
      creatingTask: 'Creating...',
      archiveTask: 'Archive task',
      archivingTask: 'Archiving...',
      createTitle: 'Create task group',
      formDescription: 'Register a local task group so related sessions can be bundled together in the console.',
      nameRequired: 'Task group title is required.',
      titleLabel: 'Task group title',
      titlePlaceholder: 'Incident review',
      sourceLabel: 'Source',
      sourcePlaceholder: 'ui',
      emptyTitle: 'No task groups recorded yet',
      emptyDescription: 'Grouped work will appear here once multiple sessions are tied together by the daemon.',
      columns: {
        taskGroup: 'Task group',
        owner: 'Owner',
        status: 'Status',
        sessions: 'Sessions',
        updated: 'Updated',
        actions: 'Actions',
      },
    },
    exposure: {
      title: 'Provider bindings',
      description: 'Gateway reachability, remote ids, and advertised endpoints stay visible alongside local history.',
      emptyTitle: 'No providers exposed',
      emptyDescription: 'Bindings such as Agents Hot and generic A2A will appear here after registration.',
      noUrlEndpoints: 'No URL endpoints advertised in this binding config.',
    },
    logs: {
      title: 'Recent daemon tail',
      unavailable: 'Log path unavailable',
      emptyTitle: 'No log lines yet',
      emptyDescription: 'The local daemon log will surface queue pressure, provider startup failures, and runtime warnings.',
    },
    status: {
      all: 'All',
      active: 'Active',
      idle: 'Idle',
      paused: 'Paused',
      queued: 'Queued',
      completed: 'Completed',
      failed: 'Failed',
      archived: 'Archived',
      public: 'Public',
      private: 'Private',
      unlisted: 'Unlisted',
      synced: 'Synced',
      pending: 'Pending',
      error: 'Error',
      configured: 'Configured',
      online: 'Online',
      inactive: 'Inactive',
    },
    role: {
      user: 'User',
      assistant: 'Assistant',
      system: 'System',
      tool: 'Tool',
      data: 'Data',
    },
  },
  zh: {
    common: {
      auto: '跟随系统',
      english: 'English',
      chinese: '简体中文',
      language: '语言',
      theme: '主题',
      system: '跟随系统',
      light: '浅色',
      dark: '深色',
      jump: '跳转',
      refreshSnapshot: '刷新快照',
      refreshingSnapshot: '刷新中...',
      offline: '离线',
      localOnly: '仅本地',
      neverSynced: '从未同步',
      cancel: '取消',
      close: '关闭',
      saveBinding: '保存绑定',
      saving: '保存中...',
      createAgent: '创建 Agent',
      creatingAgent: '创建中...',
      saveChanges: '保存修改',
      searchTranscript: '搜索转录',
      agent: 'Agent',
      taskGroup: '任务组',
      message: '消息',
      send: '发送',
      sending: '发送中...',
      forkTitle: 'Fork 标题',
      action: '操作',
      archive: '归档',
      archiving: '归档中...',
      stop: '停止',
      stopping: '停止中...',
      forkSession: 'Fork 会话',
      forkingSession: 'Fork 中...',
      metadata: '元数据',
      noMessageContent: '（无消息内容）',
      name: '名称',
      slug: 'Slug',
      runtime: 'Runtime',
      visibility: '可见性',
      projectPath: '项目路径',
      capabilities: '能力',
      description: '描述',
      provider: 'Provider',
      configJson: '配置 JSON',
      edit: '编辑',
      expose: '暴露',
      remove: '删除',
      configure: '配置',
      disable: '停用',
      filterSessions: '筛选 Session',
      showingSessions: '正在筛选',
      sandboxOn: 'Sandbox 开启',
      sandboxOff: 'Sandbox 关闭',
      providerBindings: ({ count }) => `${count} 个 provider 绑定`,
      sessionsCount: ({ count }) => `${count} 个 session`,
      createFirstAgent: '先在这里创建第一个 Agent，准备好之后再添加 provider 绑定。',
      noProviderExposure: '暂未配置 provider 暴露。',
      noProvidersAvailable: '暂无可用 provider',
      closeDialog: '关闭',
    },
    app: {
      alert: '提醒',
      snapshotRefreshFailed: '快照刷新失败',
      loading: '加载中',
      collectingState: '正在收集本地 daemon 状态',
      fetchingState: '正在拉取 agents、sessions、tasks、providers 和最近日志。',
    },
    shell: {
      localConsole: '本地控制台',
      description: '用于查看 daemon 健康状态、已注册 Agent、Session 历史、provider 暴露和最近运行情况的本地运维台。',
      uiOrigin: 'UI 地址',
      daemonStart: 'Daemon 启动时间',
      nav: {
        overview: '总览',
        agents: 'Agent',
        sessions: '会话',
        transcript: '转录',
        tasks: '任务',
        exposure: '暴露',
        logs: '日志',
      },
    },
    overview: {
      title: '一眼看清 daemon 压力与本地历史',
      description: '在检查本地注册表时，持续看到 UI 地址、队列压力和运行状态。',
      uiEndpoint: 'UI 地址',
      port: ({ port }) => `端口 ${port}`,
      bindingsLabel: 'Provider 绑定',
      agentsDetail: '已跟踪到本地 daemon 注册表',
      sessionsDetail: '完整转录历史保留在本地',
      tasksDetail: '跨 Agent 的任务分组与工作流',
      bindingsDetail: '暴露端点与网关同步状态',
      queueLoad: '队列负载',
      activeCount: ({ count }) => `${count} 个运行中`,
      queuedCount: ({ count }) => `${count} 个排队中`,
      managedSessions: '托管 Session',
      streamingCount: ({ count }) => `${count} 个正在流式执行`,
      concurrencyBudget: '并发预算',
      queueWindowMinutes: ({ count }) => `${count} 分钟队列窗口`,
      queueWindowHours: ({ count }) => `${count} 小时队列窗口`,
      trackedAgents: ({ count }) => `${count} 个已跟踪 Agent`,
      providerBindings: ({ count }) => `${count} 个 provider 绑定`,
      activeExecutions: ({ count }) => `${count} 个活跃执行`,
      taskGroups: ({ count }) => `${count} 个任务组`,
    },
    agents: {
      title: '运行中 Agent 列表',
      description: '在控制台里查看本地 Agent、筛选它们的 Session，并管理 provider 绑定。',
      emptyTitle: '还没有注册本地 Agent',
      editTitle: '编辑 Agent',
      createTitle: '创建 Agent',
      formDescription: '注册一个由本地 daemon 托管的 Agent，或更新它的运行时元数据。',
      nameRequired: '名称和项目路径是必填项。',
      slugPlaceholder: '可选',
      projectPathPlaceholder: '/absolute/path/to/project',
      capabilitiesPlaceholder: 'search, code, review',
      descriptionPlaceholder: '这个本地 Agent 主要负责什么...',
      sandboxLabel: '为这个 Agent 启用 sandbox / 工作区隔离',
      exposeTitle: '暴露 Provider',
      exposeDescription: ({ agent }) => `把 ${agent} 连接到本地或远端 provider 绑定。`,
      chooseProvider: '请选择一个 provider。',
      invalidConfigJson: '配置 JSON 无效。',
      providerPlaceholder: '选择 provider',
      removeConfirm: ({ name }) => `确认删除 Agent「${name}」吗？`,
      disableConfirm: ({ provider }) => `确认停用这个 Agent 的 ${provider} 绑定吗？`,
      remoteFallback: '仅本地',
      noDescriptionFallback: '暂无描述。',
    },
    sessions: {
      title: 'Session 面板',
      description: '按 Agent、任务组或生命周期状态筛选，而不会丢掉当前选中的 Session。',
      agentFilter: 'Agent',
      allAgents: '全部 Agent',
      taskGroupFilter: '任务组',
      allTaskGroups: '全部任务组',
      statusFilter: '状态',
      emptyTitle: '当前筛选条件下没有 Session',
      emptyDescription: '换一个 Agent、任务组或生命周期切片试试。',
      untitled: '未命名 Session',
      taskLinked: '已关联任务',
      standalone: '独立 Session',
      tagsCount: ({ count }) => `${count} 个标签`,
    },
    transcript: {
      title: '转录',
      emptySession: '选择一个 Session',
      description: '无需离开 daemon 控制台，就能查看本地 user、assistant、system 和 tool 事件。',
      startTitle: '开始一个新 Session',
      startDescription: '选择本地 Agent，可选关联任务组，然后发送第一条操作消息。',
      continueTitle: '继续当前 Session',
      continueDescription: '无需离开 dashboard，就能向当前选中的 Session 继续发送下一轮消息。',
      startPlaceholder: '让 Agent 去检查、规划或执行...',
      replyPlaceholder: '发送这一轮新的本地消息...',
      startSession: '开始 Session',
      sendReply: '发送回复',
      noTaskGroup: '不绑定任务组',
      noAgentsAvailable: '请先创建 Agent',
      selectAgentRequired: '开始新 Session 之前请先选择一个 Agent。',
      searchPlaceholder: '搜索内容、角色、类型、元数据...',
      forkPlaceholder: '实验分支',
      pickSessionTitle: '从右侧工作台选择一个 Session',
      pickSessionDescription: '转录视图会显示所有本地消息，包括 tool 和 system 事件。',
      loadingTitle: '正在加载转录...',
      loadingDescription: '正在从 daemon 拉取本地历史。',
      loadFailed: '转录加载失败',
      noMatchTitle: '没有消息匹配当前搜索',
      noMatchDescription: '清空搜索词以查看完整 Session 流。',
      scrollToBottom: '滚到底部',
    },
    tasks: {
      title: '任务组观察台',
      description: '在一个地方查看分组 Session、owner/source 元数据以及当前任务生命周期。',
      createTask: '创建任务组',
      creatingTask: '创建中...',
      archiveTask: '归档任务组',
      archivingTask: '归档中...',
      createTitle: '创建任务组',
      formDescription: '注册一个本地任务组，把相关 Session 在控制台里组织在一起。',
      nameRequired: '任务组标题是必填项。',
      titleLabel: '任务组标题',
      titlePlaceholder: '事故复盘',
      sourceLabel: '来源',
      sourcePlaceholder: 'ui',
      emptyTitle: '还没有任务组记录',
      emptyDescription: '当多个 Session 被 daemon 归为一组后，这里就会显示。',
      columns: {
        taskGroup: '任务组',
        owner: 'Owner',
        status: '状态',
        sessions: '会话数',
        updated: '更新时间',
        actions: '操作',
      },
    },
    exposure: {
      title: 'Provider 绑定',
      description: '网关可达性、远端 ID 和暴露端点会和本地历史一起展示。',
      emptyTitle: '还没有暴露任何 provider',
      emptyDescription: '接入 Agents Hot 或 generic A2A 之后，这里会出现绑定。',
      noUrlEndpoints: '这个绑定配置里没有声明 URL 端点。',
    },
    logs: {
      title: '最近 daemon 日志',
      unavailable: '日志路径不可用',
      emptyTitle: '还没有日志',
      emptyDescription: '本地 daemon 日志会展示队列压力、provider 启动失败和运行时告警。',
    },
    status: {
      all: '全部',
      active: '运行中',
      idle: '空闲',
      paused: '暂停',
      queued: '排队中',
      completed: '已完成',
      failed: '失败',
      archived: '已归档',
      public: '公开',
      private: '私有',
      unlisted: '不公开列出',
      synced: '已同步',
      pending: '等待中',
      error: '错误',
      configured: '已配置',
      online: '在线',
      inactive: '停用',
    },
    role: {
      user: '用户',
      assistant: '助手',
      system: '系统',
      tool: '工具',
      data: '数据',
    },
  },
};

function getNestedValue(tree: TranslationTree, path: string): TranslationLeaf | undefined {
  return path.split('.').reduce<TranslationTree | TranslationLeaf | undefined>((current, key) => {
    if (!current || typeof current === 'string' || typeof current === 'function') {
      return undefined;
    }
    return current[key] as TranslationTree | TranslationLeaf | undefined;
  }, tree) as TranslationLeaf | undefined;
}

function detectBrowserLanguage(): ResolvedLanguage {
  if (typeof navigator === 'undefined') {
    return 'en';
  }

  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function resolveLanguage(preference: LanguagePreference): ResolvedLanguage {
  if (preference === 'system') {
    return detectBrowserLanguage();
  }

  return preference;
}

interface I18nContextValue {
  language: LanguagePreference;
  resolvedLanguage: ResolvedLanguage;
  setLanguage(language: LanguagePreference): void;
  t(path: string, params?: TranslationParams): string;
  formatDateTime(value: string): string;
  statusLabel(value: string): string;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = React.useState<LanguagePreference>(() => {
    if (typeof window === 'undefined') {
      return 'system';
    }

    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'en' || stored === 'zh' || stored === 'system') {
      return stored;
    }
    return 'system';
  });

  const resolvedLanguage = React.useMemo(() => resolveLanguage(language), [language]);

  React.useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = resolvedLanguage === 'zh' ? 'zh-CN' : 'en';
    }
  }, [resolvedLanguage]);

  const setLanguage = React.useCallback((nextLanguage: LanguagePreference) => {
    setLanguageState(nextLanguage);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    }
  }, []);

  const t = React.useCallback((path: string, params: TranslationParams = {}): string => {
    const message =
      getNestedValue(messages[resolvedLanguage], path) ??
      getNestedValue(messages.en, path);

    if (typeof message === 'function') {
      return message(params);
    }

    if (typeof message === 'string') {
      return message;
    }

    return path;
  }, [resolvedLanguage]);

  const formatDateTime = React.useCallback((value: string): string => {
    const locale = resolvedLanguage === 'zh' ? 'zh-CN' : 'en-US';
    return new Date(value).toLocaleString(locale);
  }, [resolvedLanguage]);

  const statusLabel = React.useCallback((value: string): string => {
    return t(`status.${value.toLowerCase()}`);
  }, [t]);

  return (
    <I18nContext.Provider
      value={{
        language,
        resolvedLanguage,
        setLanguage,
        t,
        formatDateTime,
        statusLabel,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const value = React.useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used within an I18nProvider.');
  }
  return value;
}
