import { useDeferredValue, useState } from 'react';
import { Archive, MessageSquarePlus, Search, Send, SquareSplitHorizontal, StopCircle } from 'lucide-react';
import type { AgentRecord, SessionMessage, SessionRecord, TaskRecord } from '../api';

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageHeader, MessageResponse } from '@/components/ai-elements/message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface TranscriptPanelProps {
  agents: AgentRecord[];
  tasks: TaskRecord[];
  session: SessionRecord | null;
  messages: SessionMessage[];
  loading: boolean;
  error: string | null;
  actionState: 'stop' | 'archive' | 'fork' | 'send' | null;
  forkTitle: string;
  composerAgentId: string;
  composerTaskGroupId: string;
  composerMessage: string;
  onForkTitleChange(value: string): void;
  onComposerAgentChange(value: string): void;
  onComposerTaskGroupChange(value: string): void;
  onComposerMessageChange(value: string): void;
  onStop(): void;
  onArchive(): void;
  onFork(): void;
  onSendMessage(): void;
}

function normalizeRole(role: string): 'assistant' | 'system' | 'tool' | 'user' | 'data' {
  switch (role) {
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    case 'user':
      return 'user';
    default:
      return 'data';
  }
}

export function TranscriptPanel({
  agents,
  tasks,
  session,
  messages,
  loading,
  error,
  actionState,
  forkTitle,
  composerAgentId,
  composerTaskGroupId,
  composerMessage,
  onForkTitleChange,
  onComposerAgentChange,
  onComposerTaskGroupChange,
  onComposerMessageChange,
  onStop,
  onArchive,
  onFork,
  onSendMessage,
}: TranscriptPanelProps) {
  const { t, formatDateTime } = useI18n();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const canStartSession = agents.length > 0 && composerAgentId.length > 0;
  const visibleMessages = messages.filter((message) => {
    if (!deferredQuery) return true;
    return [
      message.role,
      message.kind,
      message.content,
      JSON.stringify(message.metadata),
    ].join(' ').toLowerCase().includes(deferredQuery);
  });

  return (
    <Card id="transcript" className="overflow-hidden">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('transcript.title')}</p>
            <CardTitle>{session?.title ?? t('transcript.emptySession')}</CardTitle>
            <CardDescription>
              {t('transcript.description')}
            </CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onArchive} disabled={!session || actionState !== null}>
              <Archive className="size-4" />
              {actionState === 'archive' ? t('common.archiving') : t('common.archive')}
            </Button>
            <Button type="button" variant="destructive" onClick={onStop} disabled={!session || actionState !== null}>
              <StopCircle className="size-4" />
              {actionState === 'stop' ? t('common.stopping') : t('common.stop')}
            </Button>
          </div>
        </div>

        {session ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="rounded-full">
              {session.agent?.name ?? session.agentId}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {session.origin}
            </Badge>
            <StatusBadge value={session.status} />
            <Badge variant="outline" className="rounded-full">
              {formatDateTime(session.lastActiveAt)}
            </Badge>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)_auto]">
          <label className="grid gap-2">
            <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em]">
              <Search className="size-3.5" />
              {t('common.searchTranscript')}
            </span>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('transcript.searchPlaceholder')}
              disabled={!session}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('common.forkTitle')}</span>
            <Input
              type="text"
              value={forkTitle}
              onChange={(event) => onForkTitleChange(event.target.value)}
              placeholder={t('transcript.forkPlaceholder')}
              disabled={!session || actionState !== null}
            />
          </label>

          <div className="grid gap-2">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('common.action')}</span>
            <Button type="button" onClick={onFork} disabled={!session || actionState !== null}>
              <SquareSplitHorizontal className="size-4" />
              {actionState === 'fork' ? t('common.forkingSession') : t('common.forkSession')}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <p className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em]">
                <MessageSquarePlus className="size-3.5" />
                {session ? t('transcript.continueTitle') : t('transcript.startTitle')}
              </p>
              <p className="text-sm text-foreground/80">
                {session ? t('transcript.continueDescription') : t('transcript.startDescription')}
              </p>
            </div>

            {!session ? (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">
                    {t('common.agent')}
                  </span>
                  <NativeSelect
                    value={composerAgentId}
                    onChange={(event) => onComposerAgentChange(event.target.value)}
                    disabled={actionState !== null || agents.length === 0}
                  >
                    {agents.length === 0 ? (
                      <option value="">{t('transcript.noAgentsAvailable')}</option>
                    ) : null}
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>

                <label className="grid gap-2">
                  <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">
                    {t('common.taskGroup')}
                  </span>
                  <NativeSelect
                    value={composerTaskGroupId}
                    onChange={(event) => onComposerTaskGroupChange(event.target.value)}
                    disabled={actionState !== null}
                  >
                    <option value="none">{t('transcript.noTaskGroup')}</option>
                    {tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </div>
            ) : null}

            <label className="grid gap-2">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">
                {t('common.message')}
              </span>
              <Textarea
                value={composerMessage}
                onChange={(event) => onComposerMessageChange(event.target.value)}
                placeholder={session ? t('transcript.replyPlaceholder') : t('transcript.startPlaceholder')}
                disabled={actionState !== null || (!session && !canStartSession)}
                rows={4}
              />
            </label>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={onSendMessage}
                disabled={actionState !== null || !composerMessage.trim() || (!session && !canStartSession)}
              >
                <Send className="size-4" />
                {actionState === 'send'
                  ? t('common.sending')
                  : session
                    ? t('transcript.sendReply')
                    : t('transcript.startSession')}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex min-h-[34rem] flex-1 flex-col">
          <Conversation className="min-h-[34rem]">
            {!session ? (
              <ConversationEmptyState
                title={t('transcript.pickSessionTitle')}
                description={t('transcript.pickSessionDescription')}
              />
            ) : loading ? (
              <ConversationEmptyState
                title={t('transcript.loadingTitle')}
                description={t('transcript.loadingDescription')}
              />
            ) : error ? (
              <ConversationEmptyState title={t('transcript.loadFailed')} description={error} />
            ) : visibleMessages.length === 0 ? (
              <ConversationEmptyState
                title={t('transcript.noMatchTitle')}
                description={t('transcript.noMatchDescription')}
              />
            ) : (
              <>
                <ConversationContent>
                  {visibleMessages.map((message) => (
                    <Message key={message.id} from={normalizeRole(message.role)}>
                      <MessageHeader className={cn(normalizeRole(message.role) === 'user' && 'justify-end')}>
                        <Badge variant="outline" className="rounded-full capitalize">
                          {t(`role.${message.role}`)}
                        </Badge>
                        <Badge variant="secondary" className="rounded-full">
                          {message.kind}
                        </Badge>
                        <span>{formatDateTime(message.createdAt)}</span>
                        <span>#{message.seq}</span>
                      </MessageHeader>

                      <MessageContent>
                        <MessageResponse>{message.content || t('common.noMessageContent')}</MessageResponse>

                        {Object.keys(message.metadata).length > 0 ? (
                          <details className="mt-3 rounded-xl border border-border/70 bg-background/60 p-3 text-xs text-foreground/80">
                            <summary className="cursor-pointer list-none font-medium">{t('common.metadata')}</summary>
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono leading-5">
                              {JSON.stringify(message.metadata, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </MessageContent>
                    </Message>
                  ))}
                </ConversationContent>

                <ConversationScrollButton />
              </>
            )}
          </Conversation>
        </div>

      </CardContent>
    </Card>
  );
}
