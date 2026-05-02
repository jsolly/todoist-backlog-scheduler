import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { Handler } from "aws-lambda";
import { runScheduler } from "../../../src/scheduler.ts";
import { createLogger } from "../../../src/shared/logging.ts";

const logger = createLogger({ job: "todoist-backlog-scheduler" });
const ssm = new SSMClient({});

export const handler: Handler<unknown, { statusCode: number; body: string }> = async () => {
	const parameterName = process.env.SSM_PARAMETER_NAME;
	if (!parameterName) {
		throw new Error("SSM_PARAMETER_NAME not configured");
	}

	const response = await ssm.send(
		new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
	);
	const apiKey = response.Parameter?.Value;
	if (!apiKey) {
		throw new Error(`SSM parameter ${parameterName} returned no value`);
	}
	process.env.TODOIST_API_KEY = apiKey;

	const result = await runScheduler();
	logger.info("handler complete", { tasksDistributed: result.tasksDistributed });
	return { statusCode: 200, body: JSON.stringify(result) };
};
