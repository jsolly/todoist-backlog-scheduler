import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const LOGGER_HASH = "b71dea637f4e915c6199648f6920e6e4b749eab0119321c6fcb9751bbdf15719";
// LOGGER_HASH is rewritten by ~/code/family-memory/scripts/sync-shared-logger.sh on sync.
// Matches sync-shared-logger.sh's `combined_hash`: strip BOM, CRLF -> LF,
// trim trailing newlines, append exactly one, then SHA-256(logger || test).

function normalize(path: string): string {
	const raw = readFileSync(path, "utf8");
	return `${raw.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\n*$/, "")}\n`;
}

describe("logger snapshot", () => {
	it("matches the canonical hash distributed by sync-shared-logger.sh", () => {
		const repoRoot = resolve(__dirname, "..");
		const logger = normalize(resolve(repoRoot, "src/shared/logging.ts"));
		const contract = normalize(resolve(repoRoot, "tests/logging-contract.test.ts"));
		const hash = createHash("sha256")
			.update(logger + contract)
			.digest("hex");

		expect(hash).toBe(LOGGER_HASH);
	});
});
