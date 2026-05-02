import { runScheduler } from "./scheduler.ts";
import { createLogger } from "./shared/logging.ts";

const logger = createLogger({ job: "todoist-backlog-scheduler-cli" });

const result = await runScheduler();
logger.info(result.message, { tasksDistributed: result.tasksDistributed });
