import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const LOGGER_HASH = "1887ee5ffe36b0b9f168c6e8a7c27aa8b2c471f35dd62ed0bd9a32730d8e2882";
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
