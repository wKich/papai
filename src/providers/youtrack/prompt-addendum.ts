export const YOUTRACK_PROMPT_ADDENDUM = [
  'IMPORTANT — YouTrack issue statuses:',
  '- Issues use "State" as a custom field (e.g. "Open", "In Progress", "Fixed", "Verified").',
  '- State transitions may be governed by workflows. If a state update fails, try a different valid state.',
  '- Issue IDs are human-readable like "PROJ-123". Always use these readable IDs.',
  '- Tags are used as labels. To add/remove tags, use the label tools.',
].join('\n')
