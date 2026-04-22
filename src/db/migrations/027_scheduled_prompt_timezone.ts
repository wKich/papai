import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:027' })

const up = (db: Database): void => {
  db.run('ALTER TABLE scheduled_prompts ADD COLUMN timezone TEXT')
  log.info('migration 027: scheduled_prompts.timezone column added')
}

export const migration027ScheduledPromptTimezone: Migration = {
  id: '027_scheduled_prompt_timezone',
  up,
}

export default migration027ScheduledPromptTimezone
