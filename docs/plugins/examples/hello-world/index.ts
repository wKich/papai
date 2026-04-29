import { z } from 'zod'

import type { PluginContext } from '../../../../src/plugins/context.js'
import type { PluginFactory } from '../../../../src/plugins/types.js'

const greetingInputSchema = z.object({
  name: z.string(),
})

const factory: PluginFactory = {
  activate(ctx: PluginContext) {
    ctx.log.info({}, 'hello-world plugin activated')

    ctx.registration.registerTool({
      name: 'greet',
      description: 'Greet a person by name',
      inputSchema: greetingInputSchema,
      execute(args: unknown): Promise<unknown> {
        const input = greetingInputSchema.parse(args)
        return Promise.resolve({ greeting: `Hello, ${input.name}! 👋` })
      },
    })

    ctx.registration.registerPromptFragment({
      name: 'hello-world-hint',
      content: 'When the user asks for a greeting, use the greet tool.',
    })
  },

  deactivate(ctx: PluginContext) {
    ctx.log.info({}, 'hello-world plugin deactivated')
  },
}

export default factory
