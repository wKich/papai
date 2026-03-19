import { ListTasksResponseCompatSchema } from '../../../schemas/kaneo/api-compat.js'

// Re-export compat schemas — icon/color are optional due to upstream Kaneo bug.
// See src/kaneo/schemas/api-compat.ts for details.
export { ListTasksResponseCompatSchema as GetTasksResponseSchema }
