import { describe, expect, it, vi } from "vitest";
import { createLogger, runWithRequestContext } from "../src/shared/logging";

function captureStderr() {
	return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

function lastWrite(spy: ReturnType<typeof captureStderr>): string {
	const [chunk] = spy.mock.lastCall ?? [];
	if (typeof chunk !== "string") {
		throw new Error("expected string chunk");
	}
	return chunk;
}

describe("logging contract", () => {
	it("emits level=error JSON that metric filters and alert-hub accept", () => {
		vi.stubEnv("LOG_MASK_PII", "true");
		const spy = captureStderr();

		try {
			createLogger({ job: "contract-test" }).error(
				"boom",
				{ recipient: "+12793212870" },
				new Error("kaboom"),
			);

			const line = lastWrite(spy);
			expect(line.endsWith("\n")).toBe(true);
			const parsed = JSON.parse(line);
			expect(parsed.level).toBe("error");
			expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(parsed.message).toBe("boom");
			expect(parsed.error).toMatchObject({ name: "Error", message: "kaboom" });
			expect(JSON.stringify(parsed)).not.toContain("+12793212870");
		} finally {
			spy.mockRestore();
			vi.unstubAllEnvs();
		}
	});

	it("redacts sensitive-named keys nested inside error.raw", () => {
		const spy = captureStderr();
		try {
			const postgrestLike = {
				message: "duplicate key value violates unique constraint",
				code: "23505",
				details: "Key (email)=(user@example.com) already exists",
				apiKey: "sk-live-abcdef1234567890",
			};
			createLogger({ job: "contract-test" }).error("db error", undefined, postgrestLike);

			const serialized = lastWrite(spy);
			expect(serialized).not.toContain("sk-live-abcdef1234567890");
			expect(serialized).toContain("[REDACTED]");

			const parsed = JSON.parse(serialized);
			expect(parsed.error).toMatchObject({
				message: "duplicate key value violates unique constraint",
				raw: { code: "23505", apiKey: "[REDACTED]" },
			});
		} finally {
			spy.mockRestore();
		}
	});

	it("handles circular error causes without throwing", () => {
		const spy = captureStderr();
		try {
			const circular = new Error("self-causal") as Error & { cause?: unknown };
			circular.cause = circular;

			expect(() => {
				createLogger({ job: "contract-test" }).error("boom", undefined, circular);
			}).not.toThrow();

			const parsed = JSON.parse(lastWrite(spy));
			expect(parsed.error).toMatchObject({
				name: "Error",
				message: "self-causal",
			});
			expect(parsed.error.cause).toMatchObject({
				name: "Error",
				message: "self-causal",
				cause: "[Circular]",
			});
		} finally {
			spy.mockRestore();
		}
	});

	it("routes info to stdout and warn to stderr", () => {
		const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			const log = createLogger({ job: "contract-test" });
			log.info("started");
			log.warn("retrying upstream");

			const stdoutLine = (stdoutSpy.mock.lastCall ?? [])[0];
			const stderrLine = (stderrSpy.mock.lastCall ?? [])[0];
			expect(typeof stdoutLine).toBe("string");
			expect(typeof stderrLine).toBe("string");
			expect(JSON.parse(stdoutLine as string).level).toBe("info");
			expect(JSON.parse(stderrLine as string).level).toBe("warn");
		} finally {
			stdoutSpy.mockRestore();
			stderrSpy.mockRestore();
		}
	});

	it("Lambda handler invocation propagates awsRequestId to module-scope logger calls", async () => {
		const spy = captureStderr();
		try {
			const log = createLogger({ job: "contract-test" });
			const requestId = "01HZX9P3KB7QH8M2NGY8KZRP4V";

			await runWithRequestContext(requestId, async () => {
				log.error("downstream failed", undefined, new Error("upstream 500"));
				await new Promise((r) => setImmediate(r));
				log.error("retry exhausted", undefined, new Error("giving up"));
			});

			const calls = spy.mock.calls.map(([chunk]) => JSON.parse(chunk as string));
			expect(calls).toHaveLength(2);
			expect(calls[0].requestId).toBe(requestId);
			expect(calls[1].requestId).toBe(requestId);
		} finally {
			spy.mockRestore();
		}
	});

	it("explicit requestId in call context overrides the ambient handler context", () => {
		const spy = captureStderr();
		try {
			runWithRequestContext("ambient-id", () => {
				createLogger({ job: "contract-test" }).error("audit event", {
					requestId: "explicit-call-id",
				});
			});

			const parsed = JSON.parse(lastWrite(spy));
			expect(parsed.requestId).toBe("explicit-call-id");
		} finally {
			spy.mockRestore();
		}
	});
});
