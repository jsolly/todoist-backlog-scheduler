import type { Handler } from "aws-lambda";
import { runScheduler } from "../../../src/scheduler.ts";
import { createLogger, runWithRequestContext } from "../../../src/shared/logging.ts";

const logger = createLogger({ job: "todoist-backlog-scheduler" });

export const handler: Handler<unknown, { statusCode: number; body: string }> = (_event, context) =>
	runWithRequestContext(context.awsRequestId, async () => {
		if (!process.env.TODOIST_API_KEY) {
			throw new Error("TODOIST_API_KEY not configured");
		}

		try {
			const result = await runScheduler();
			logger.info("handler complete", { tasksDistributed: result.tasksDistributed });
			return { statusCode: 200, body: JSON.stringify(result) };
		} catch (error) {
			const taskCount =
				error instanceof Error && "taskCount" in error
					? (error as Error & { taskCount?: number }).taskCount
					: undefined;
			logger.error("todoist_backlog_sync_failed", { taskCount, failurePhase: "scheduler" }, error);
			throw error;
		}
	});
