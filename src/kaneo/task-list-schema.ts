import { ColumnCompatSchema, ListTasksResponseCompatSchema } from './schemas/api-compat.js'
import { TaskSchema } from './schemas/createTask.js'

// Re-export compat schemas — icon/color are optional due to upstream Kaneo bug.
// See src/kaneo/schemas/api-compat.ts for details.
export { ListTasksResponseCompatSchema as GetTasksResponseSchema, ColumnCompatSchema as ColumnSchema }
export { TaskSchema as GetTasksTaskSchema }
