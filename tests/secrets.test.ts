import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@aws-sdk/client-ssm", () => ({
	// Classes (not arrow fns) so `new SSMClient()` / `new GetParameterCommand()` construct.
	SSMClient: class {
		send = sendMock;
	},
	GetParameterCommand: class {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	},
}));

// Each test re-imports the module after vi.resetModules() so the module-level
// cache in secrets.ts starts empty.
async function freshGetTodoistApiKey() {
	vi.resetModules();
	const mod = await import("../src/shared/secrets.ts");
	return mod.getTodoistApiKey;
}

describe("getTodoistApiKey", () => {
	beforeEach(() => {
		sendMock.mockReset();
		delete process.env.TODOIST_API_KEY;
		delete process.env.TODOIST_API_KEY_SSM_PARAM;
	});

	afterEach(() => {
		delete process.env.TODOIST_API_KEY;
		delete process.env.TODOIST_API_KEY_SSM_PARAM;
	});

	it("returns the TODOIST_API_KEY env var without calling SSM", async () => {
		process.env.TODOIST_API_KEY = "env-key";
		const getTodoistApiKey = await freshGetTodoistApiKey();
		await expect(getTodoistApiKey()).resolves.toBe("env-key");
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("throws when neither the env var nor the SSM param name is set", async () => {
		const getTodoistApiKey = await freshGetTodoistApiKey();
		await expect(getTodoistApiKey()).rejects.toThrow(/TODOIST_API_KEY/);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("fetches the SecureString from SSM and caches it across calls", async () => {
		process.env.TODOIST_API_KEY_SSM_PARAM = "/todoist-backlog-scheduler/api-key";
		sendMock.mockResolvedValue({ Parameter: { Value: "ssm-key" } });
		const getTodoistApiKey = await freshGetTodoistApiKey();

		await expect(getTodoistApiKey()).resolves.toBe("ssm-key");
		await expect(getTodoistApiKey()).resolves.toBe("ssm-key");
		expect(sendMock).toHaveBeenCalledTimes(1); // second call served from cache
	});

	it("requests decryption for the configured parameter name", async () => {
		process.env.TODOIST_API_KEY_SSM_PARAM = "/todoist-backlog-scheduler/api-key";
		sendMock.mockResolvedValue({ Parameter: { Value: "ssm-key" } });
		const getTodoistApiKey = await freshGetTodoistApiKey();

		await getTodoistApiKey();
		expect(sendMock).toHaveBeenCalledWith(
			expect.objectContaining({
				input: { Name: "/todoist-backlog-scheduler/api-key", WithDecryption: true },
			}),
		);
	});

	it.each([
		["missing Value", { Parameter: {} }],
		["empty-string Value", { Parameter: { Value: "" } }],
	])("throws when the SSM parameter has %s", async (_label, response) => {
		process.env.TODOIST_API_KEY_SSM_PARAM = "/todoist-backlog-scheduler/api-key";
		sendMock.mockResolvedValue(response);
		const getTodoistApiKey = await freshGetTodoistApiKey();
		await expect(getTodoistApiKey()).rejects.toThrow(/no value/);
	});

	it("does NOT cache a failed fetch — a transient SSM error is retried, not cached", async () => {
		process.env.TODOIST_API_KEY_SSM_PARAM = "/todoist-backlog-scheduler/api-key";
		sendMock.mockRejectedValueOnce(new Error("AccessDeniedException"));
		const getTodoistApiKey = await freshGetTodoistApiKey();

		await expect(getTodoistApiKey()).rejects.toThrow(/AccessDenied/);
		// Next call must re-attempt (failure was not cached) and can now succeed.
		sendMock.mockResolvedValue({ Parameter: { Value: "ssm-key" } });
		await expect(getTodoistApiKey()).resolves.toBe("ssm-key");
		expect(sendMock).toHaveBeenCalledTimes(2);
	});

	it("env var wins even after the SSM value was cached", async () => {
		process.env.TODOIST_API_KEY_SSM_PARAM = "/todoist-backlog-scheduler/api-key";
		sendMock.mockResolvedValue({ Parameter: { Value: "ssm-key" } });
		const getTodoistApiKey = await freshGetTodoistApiKey();

		await expect(getTodoistApiKey()).resolves.toBe("ssm-key"); // populates cache
		process.env.TODOIST_API_KEY = "override-key";
		await expect(getTodoistApiKey()).resolves.toBe("override-key");
		expect(sendMock).toHaveBeenCalledTimes(1); // env path skips SSM entirely
	});
});
