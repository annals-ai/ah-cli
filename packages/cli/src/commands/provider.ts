import type { Command } from 'commander';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, YELLOW, RED, RESET, renderTable, type Column } from '../utils/table.js';

function statusColor(status: string): string {
  switch (status) {
    case 'online': return GREEN;
    case 'connecting': return YELLOW;
    case 'error':
    case 'auth_failed':
    case 'replaced': return RED;
    default: return GRAY;
  }
}

export function registerProviderCommand(program: Command): void {
  const provider = program
    .command('provider')
    .description('Manage provider network membership and connections');

  provider
    .command('status')
    .description('Show provider network status and exposed agents')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{
        provider: string;
        authenticated: boolean;
        agents: Array<{
          slug: string;
          name: string;
          status: string;
          remoteAgentId: string | null;
          remoteSlug: string | null;
          lastSyncedAt: string | null;
        }>;
        network: {
          id: string | null;
          name: string | null;
          memberCount: number;
          role: string | null;
        } | null;
      }>('provider.status', {});

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`${BOLD}Provider:${RESET} ${result.provider}`);
      console.log(`${BOLD}Auth:${RESET}     ${result.authenticated ? `${GREEN}logged in${RESET}` : `${RED}not authenticated${RESET}`}`);

      if (result.network) {
        console.log(`${BOLD}Network:${RESET}  ${result.network.name ?? result.network.id ?? 'default'}`);
        console.log(`${BOLD}Role:${RESET}     ${result.network.role ?? 'member'}`);
        console.log(`${BOLD}Members:${RESET}  ${result.network.memberCount}`);
      }

      if (result.agents.length === 0) {
        console.log(`\n${GRAY}No agents exposed. Run: ah agent expose <ref> --provider agents-hot${RESET}`);
        return;
      }

      console.log();
      const columns: Column[] = [
        { key: 'slug', label: 'AGENT', width: 24 },
        { key: 'status', label: 'STATUS', width: 14 },
        { key: 'remoteSlug', label: 'REMOTE', width: 24 },
        { key: 'lastSyncedAt', label: 'LAST SYNC', width: 22 },
      ];
      const rows = result.agents.map((a) => ({
        slug: a.slug,
        status: `${statusColor(a.status)}${a.status}${RESET}`,
        remoteSlug: a.remoteSlug ?? GRAY + '—' + RESET,
        lastSyncedAt: a.lastSyncedAt
          ? new Date(a.lastSyncedAt).toLocaleString()
          : GRAY + '—' + RESET,
      }));
      console.log(renderTable(columns, rows));
    });

  provider
    .command('join <invite-code>')
    .description('Join a provider network using an invite code')
    .action(async (inviteCode: string) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{
        network: { id: string; name: string };
        role: string;
      }>('provider.join', { inviteCode });
      log.success(`Joined network: ${BOLD}${result.network.name}${RESET} (role: ${result.role})`);
    });

  provider
    .command('invite')
    .description('Generate an invite code for the provider network')
    .option('--email <email>', 'Send invite to a specific email')
    .option('--role <role>', 'Assign role: admin | member', 'member')
    .option('--expires <duration>', 'Expiration: 1d, 7d, 30d', '7d')
    .action(async (opts: { email?: string; role: string; expires: string }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{
        inviteCode: string;
        expiresAt: string;
        sentTo: string | null;
      }>('provider.invite', {
        email: opts.email,
        role: opts.role,
        expires: opts.expires,
      });

      if (result.sentTo) {
        log.success(`Invite sent to ${BOLD}${result.sentTo}${RESET}`);
      } else {
        log.success('Invite code generated:');
        console.log(`\n  ${BOLD}${result.inviteCode}${RESET}\n`);
      }
      console.log(`${GRAY}Expires: ${new Date(result.expiresAt).toLocaleString()}${RESET}`);
    });

  provider
    .command('members')
    .description('List members of the provider network')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{
        members: Array<{
          id: string;
          name: string | null;
          email: string | null;
          role: string;
          agentCount: number;
          joinedAt: string;
          lastActiveAt: string | null;
        }>;
      }>('provider.members', {});

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.members.length === 0) {
        console.log(`${GRAY}No members in network.${RESET}`);
        return;
      }

      const columns: Column[] = [
        { key: 'name', label: 'MEMBER', width: 24 },
        { key: 'role', label: 'ROLE', width: 10 },
        { key: 'agentCount', label: 'AGENTS', width: 8, align: 'right' },
        { key: 'lastActiveAt', label: 'LAST ACTIVE', width: 22 },
      ];
      const rows = result.members.map((m) => ({
        name: m.name ?? m.email ?? m.id.slice(0, 8),
        role: m.role === 'admin' ? `${YELLOW}${m.role}${RESET}` : m.role,
        agentCount: String(m.agentCount),
        lastActiveAt: m.lastActiveAt
          ? new Date(m.lastActiveAt).toLocaleString()
          : GRAY + '—' + RESET,
      }));
      console.log(renderTable(columns, rows));
    });

  provider
    .command('kick <member-id>')
    .description('Remove a member from the provider network')
    .option('--force', 'Skip confirmation')
    .action(async (memberId: string, opts: { force?: boolean }) => {
      if (!opts.force) {
        const { createInterface } = await import('node:readline');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Remove member ${BOLD}${memberId}${RESET} from the network? (y/N) `, resolve);
        });
        rl.close();
        if (answer !== 'y' && answer !== 'yes') {
          log.info('Aborted.');
          return;
        }
      }

      await ensureDaemonRunning();
      const result = await requestDaemon<{
        ok: boolean;
        memberId: string;
      }>('provider.kick', { memberId });
      log.success(`Member ${BOLD}${result.memberId}${RESET} removed from the network.`);
    });
}
