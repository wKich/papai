import { logger } from '../../logger.js'
import type { KaneoConfig } from './client.js'
import { ColumnResource } from './column-resource.js'
import { CommentResource } from './comment-resource.js'
import { LabelResource } from './label-resource.js'
import { ProjectResource } from './project-resource.js'
import { TaskResource } from './task-resource.js'

export class KaneoClient {
  private log = logger.child({ scope: 'kaneo:client' })

  constructor(private config: KaneoConfig) {
    this.log.debug({ baseUrl: config.baseUrl }, 'KaneoClient initialized')
  }

  get tasks(): TaskResource {
    return new TaskResource(this.config)
  }

  get projects(): ProjectResource {
    return new ProjectResource(this.config)
  }

  get labels(): LabelResource {
    return new LabelResource(this.config)
  }

  get comments(): CommentResource {
    return new CommentResource(this.config)
  }

  get columns(): ColumnResource {
    return new ColumnResource(this.config)
  }
}
