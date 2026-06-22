import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

// Fetch the Todoist API key at runtime so it never lives in a plaintext Lambda
// env var. The template (aws/template.yaml) carries the full rationale and the
// design-doc link.

let cachedApiKey: string | undefined;
let ssmClient: SSMClient | undefined;

export async function getTodoistApiKey(): Promise<string> {
	// Local dev / tests: an explicit env var wins and keeps them offline (prod
	// never sets this, so the Lambda always falls through to the SSM fetch). Not
	// cached — reading process.env is free and avoids leaking a test value into
	// later cases.
	const fromEnv = process.env.TODOIST_API_KEY;
	if (fromEnv) {
		return fromEnv;
	}

	if (cachedApiKey) {
		return cachedApiKey;
	}

	const paramName = process.env.TODOIST_API_KEY_SSM_PARAM;
	if (!paramName) {
		throw new Error(
			"TODOIST_API_KEY not configured: set TODOIST_API_KEY (local) or TODOIST_API_KEY_SSM_PARAM (Lambda)",
		);
	}

	ssmClient ??= new SSMClient({});
	const { Parameter } = await ssmClient.send(
		new GetParameterCommand({ Name: paramName, WithDecryption: true }),
	);
	const value = Parameter?.Value;
	if (!value) {
		throw new Error(`TODOIST_API_KEY SSM parameter ${paramName} has no value`);
	}

	cachedApiKey = value;
	return value;
}
