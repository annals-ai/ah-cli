import { createRequire } from 'node:module';
import { program } from 'commander';
import { registerLoginCommand } from './commands/login.js';
import { registerStatusCommand } from './commands/status.js';
import { registerAgentCommand } from './commands/agent.js';
import { registerAgentsShortcutCommand } from './commands/agents-shortcut.js';
import { registerChatCommand } from './commands/chat.js';
import { registerSkillsCommand } from './commands/skills.js';
import { registerDiscoverCommand } from './commands/discover.js';
import { registerCallCommand } from './commands/call.js';
import { registerSubscribeCommand } from './commands/subscribe.js';
import { registerProfileCommand } from './commands/profile.js';
import { registerFanOutCommand } from './commands/fan-out.js';
import { registerDaemonCommand } from './commands/daemon.js';
import { registerTaskCommand } from './commands/task.js';
import { registerTasksShortcutCommand } from './commands/tasks-shortcut.js';
import { registerSessionCommand } from './commands/session.js';
import { registerSessionsShortcutCommand } from './commands/sessions-shortcut.js';
import { registerPsShortcutCommand } from './commands/ps-shortcut.js';
import { registerUiCommand } from './commands/ui.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerConfigCommand } from './commands/config.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerPipelineCommand } from './commands/pipeline.js';
import { maybeAutoUpgradeOnStartup } from './utils/auto-updater.js';
import { maybePrintDocsHint } from './utils/config.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const autoUpgrade = maybeAutoUpgradeOnStartup({ currentVersion: version });
if (autoUpgrade.relaunched) {
  process.exit(autoUpgrade.exitCode ?? 0);
}

program
  .name('ah')
  .description('Run local AI agents through a daemon-first mesh runtime')
  .version(version)
  .option('-v', 'output the version number')
  .on('option:v', () => { console.log(version); process.exit(0); });

program.configureOutput({
  outputError: (str, write) => {
    write(str);
    if (str.trim().length > 0) {
      write('\nDocs: https://agents.hot/docs/cli-reference\n');
    }
  },
});

registerLoginCommand(program);
registerStatusCommand(program);
registerDaemonCommand(program);
registerUiCommand(program);
registerAgentCommand(program);
registerAgentsShortcutCommand(program);
registerTaskCommand(program);
registerTasksShortcutCommand(program);
registerSessionCommand(program);
registerSessionsShortcutCommand(program);
registerPsShortcutCommand(program);
registerChatCommand(program);
registerSkillsCommand(program);
registerDiscoverCommand(program);
registerCallCommand(program);
registerSubscribeCommand(program);
registerProfileCommand(program);
registerFanOutCommand(program);
registerMcpCommand(program);
registerConfigCommand(program);
registerDoctorCommand(program);
registerPipelineCommand(program);

program
  .command('help')
  .description('Show CLI help')
  .option('--json', 'Output machine-readable command reference')
  .action((opts: { json?: boolean }) => {
    if (opts.json) {
      const commands = program.commands
        .map((cmd) => cmd.name())
        .filter((name) => name !== 'help');
      console.log(JSON.stringify({
        name: 'ah',
        docs: 'https://agents.hot/docs/cli-reference',
        commands,
      }));
      return;
    }
    program.outputHelp();
  });

const wantsJsonOutput = process.argv.includes('--json');
if (!wantsJsonOutput && !process.argv.includes('--version') && !process.argv.includes('-v')) {
  maybePrintDocsHint('https://agents.hot/docs/cli-reference');
}

program.parse();
