const DOMAIN_RULES: ReadonlyArray<readonly [string, string]> = [
  ['tests/tools/', 'tools'],
  ['tests/commands/', 'commands'],
  ['tests/chat/telegram/', 'chat-telegram'],
  ['tests/chat/mattermost/', 'chat-mattermost'],
  ['tests/chat/discord/', 'chat-discord'],
  ['tests/chat/', 'chat'],
  ['tests/providers/kaneo/', 'providers-kaneo'],
  ['tests/providers/youtrack/', 'providers-youtrack'],
  ['tests/providers/', 'providers'],
  ['tests/config-editor/', 'config-editor'],
  ['tests/group-settings/', 'group-settings'],
  ['tests/message-queue/', 'message-queue'],
  ['tests/deferred-prompts/', 'deferred-prompts'],
  ['tests/identity/', 'identity'],
  ['tests/web/', 'web'],
  ['tests/wizard/', 'wizard'],
  ['tests/debug/', 'debug'],
  ['tests/db/', 'db'],
  ['tests/message-cache/', 'message-cache'],
]

export function getDomain(testPath: string): string {
  for (const [prefix, domain] of DOMAIN_RULES) {
    if (testPath.startsWith(prefix)) return domain
  }
  return 'core'
}
