import { describe, expect, it, vi } from "vitest";
import { payloadLogFields, preparePayloadForLog } from "../src/shared/log-payload";

describe("preparePayloadForLog", () => {
	it("returns omitted for null and undefined", () => {
		expect(preparePayloadForLog(null)).toEqual({
			mode: "omitted",
			byteLength: 0,
			reason: "empty",
		});
		expect(preparePayloadForLog(undefined)).toEqual({
			mode: "omitted",
			byteLength: 0,
			reason: "empty",
		});
	});

	it("keeps small objects in full mode", () => {
		const prepared = preparePayloadForLog({ route: "POST /ingest", contributor: "john" });
		expect(prepared.mode).toBe("full");
		if (prepared.mode === "full") {
			expect(prepared.value).toEqual({ route: "POST /ingest", contributor: "john" });
			expect(prepared.byteLength).toBeGreaterThan(0);
		}
	});

	it("switches to preview mode when serialized payload exceeds 4KB", () => {
		const prepared = preparePayloadForLog({ blob: "x".repeat(10_000) });
		expect(prepared.mode).toBe("preview");
		if (prepared.mode === "preview") {
			expect(prepared.byteLength).toBeGreaterThan(4096);
			expect(prepared.omittedBytes).toBeGreaterThan(0);
			expect(prepared.encoding).toBe("json");
			expect(prepared.preview.length).toBeLessThan(10_000);
		}
	});

	it("truncates long strings to preview with 500-char cap", () => {
		const prepared = preparePayloadForLog("y".repeat(10_000), {
			maxFullBytes: 100,
			maxPreviewBytes: 600,
			maxStringChars: 500,
		});
		expect(prepared.mode).toBe("preview");
		if (prepared.mode === "preview") {
			expect(prepared.preview.length).toBeLessThanOrEqual(500);
			expect(prepared.encoding).toBe("text");
		}
	});

	it("redacts sensitive keys and PII in strings", () => {
		vi.stubEnv("LOG_MASK_PII", "true");
		try {
			const prepared = preparePayloadForLog({
				email: "user@example.com",
				apiKey: "sk-live-secret",
				phone: "+1 (555) 123-4567",
				note: "call me at 555-123-4567",
			});
			expect(prepared.mode).toBe("full");
			if (prepared.mode === "full") {
				const value = prepared.value as Record<string, unknown>;
				expect(value.apiKey).toBe("[REDACTED]");
				expect(value.phone).toBe("[REDACTED]");
				expect(value.email).toBe("[REDACTED]");
				expect(value.note).toBe("call me at [REDACTED]");
			}
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("payloadLogFields maps full, preview, and omitted modes", () => {
		const full = payloadLogFields({ mode: "full", byteLength: 12, value: { ok: true } }, "request");
		expect(full).toEqual({
			requestMode: "full",
			requestByteLength: 12,
			request: { ok: true },
		});

		const preview = payloadLogFields(
			{
				mode: "preview",
				byteLength: 9000,
				omittedBytes: 1000,
				preview: '{"a":1}',
				encoding: "json",
			},
			"body",
		);
		expect(preview).toMatchObject({
			bodyMode: "preview",
			bodyByteLength: 9000,
			bodyOmittedBytes: 1000,
			bodyPreview: '{"a":1}',
			bodyEncoding: "json",
			truncated: true,
		});

		const omitted = payloadLogFields(
			{ mode: "omitted", byteLength: 0, reason: "empty" },
			"payload",
		);
		expect(omitted).toEqual({
			payloadMode: "omitted",
			payloadByteLength: 0,
			payloadOmittedReason: "empty",
		});
	});
});
