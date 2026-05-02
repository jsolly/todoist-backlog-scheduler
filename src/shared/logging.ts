/**
 * Canonical Node Lambda structured logger for alert-hub-wired projects.
 * Distributed to consumer repos by ~/code/family-memory/scripts/sync-shared-logger.sh.
 * Behavior is pinned by tests/logging-contract.test.ts (also synced) and a per-repo
 * tests/logging-snapshot.test.ts that hashes this file against a managed constant.
 *
 * Writes raw JSON to stdout (debug/info) and stderr (warn/error). The Node Lambda
 * runtime ships both streams to CloudWatch; metric filters on `{ $.level = "error" }`
 * match the JSON regardless of any tab-prefix the runtime would otherwise add.
 *
 * Bypassing console.* loses the runtime's auto-prefixed awsRequestId; handlers
 * should wrap their work in `runWithRequestContext(context.awsRequestId, fn)`
 * so every log entry carries the invocation's requestId without DI plumbing.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown> & {
	requestId?: string;
};

type LogEntry = {
	timestamp: string;
	level: LogLevel;
	message: string;
	context?: Record<string, unknown>;
	requestId?: string;
	error?: {
		name?: string;
		message: string;
		stack?: string;
		raw?: unknown;
		cause?: unknown;
	};
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_CANDIDATE_RE = /(?:\+\d{1,3}[\s().-]*)?\(?\d{3}\)?[\s().-]*\d{3}[\s().-]*\d{4}/g;

const SENSITIVE_KEY_PATTERNS = [
	"secret",
	"password",
	"apikey",
	"api_key",
	"credential",
	"authtoken",
	"auth_token",
	"access_token",
	"refresh_token",
	"authorization",
];

function isSensitiveKey(key: string): boolean {
	const lower = key.toLowerCase();
	return (
		lower === "token" ||
		lower.endsWith("token") ||
		SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p))
	);
}

function maskPiiInContext(context: LogContext, maskPiiEnabled: boolean): LogContext {
	const masked: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(context)) {
		if (key === "requestId") {
			masked[key] = value;
			continue;
		}
		if (isSensitiveKey(key)) {
			masked[key] = "[REDACTED]";
			continue;
		}
		if (!maskPiiEnabled) {
			masked[key] = value;
			continue;
		}
		const lowerKey = key.toLowerCase();
		const isPhoneKey =
			lowerKey.includes("phone") || lowerKey === "countrycode" || lowerKey === "country_code";
		let looksLikePhone = false;
		if (typeof value === "string") {
			looksLikePhone = PHONE_CANDIDATE_RE.test(value);
			PHONE_CANDIDATE_RE.lastIndex = 0;
		}

		if (isPhoneKey || looksLikePhone) {
			masked[key] = "[REDACTED]";
			continue;
		}

		masked[key] = value;
	}
	return masked as LogContext;
}

function maskPiiInString(value: string, maskPiiEnabled: boolean): string {
	if (!maskPiiEnabled) {
		return value;
	}
	const maskedEmail = value.replace(EMAIL_RE, "[REDACTED]");
	return maskedEmail.replace(PHONE_CANDIDATE_RE, (match) => {
		const digits = match.replace(/\D/g, "");
		if (digits.length < 10) {
			return match;
		}
		return "[REDACTED]";
	});
}

function serializeError(error: unknown): NonNullable<LogEntry["error"]> {
	if (error instanceof Error) {
		const serialized: NonNullable<LogEntry["error"]> = {
			name: error.name,
			message: error.message,
			cause: error.cause,
		};
		if (error.stack !== undefined) {
			serialized.stack = error.stack;
		}
		return serialized;
	}

	if (typeof error === "string") {
		return { message: error };
	}

	// Library errors like Supabase's PostgrestError are plain objects, not Error
	// instances. Preserve the whole object in `raw` so code/hint/details survive
	// without coupling to any library's type.
	if (
		error !== null &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message: unknown }).message === "string"
	) {
		return {
			message: (error as { message: string }).message,
			raw: error,
		};
	}

	return {
		message: "Non-Error thrown",
		raw: error,
	};
}

function getMaskPiiEnabled(): boolean {
	return process.env.LOG_MASK_PII?.toLowerCase() !== "false";
}

function safeJsonStringify(value: unknown, maskPiiEnabled: boolean): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(value, (key, entry) => {
		// Track objects (including Errors) for cycles BEFORE any other handling.
		// Required for `error.cause = self` and similar self-referential graphs:
		// without this, serializeError below would recurse forever.
		if (typeof entry === "object" && entry !== null) {
			if (seen.has(entry)) {
				return "[Circular]";
			}
			seen.add(entry);
		}
		// Redact sensitive-named keys anywhere in the tree (maskPiiInContext only
		// walks the top-level context, leaving nested objects like error.raw and
		// entry.error.cause exposed).
		if (key !== "" && isSensitiveKey(key)) {
			return "[REDACTED]";
		}
		if (typeof entry === "bigint") {
			return entry.toString();
		}
		if (entry instanceof Error) {
			return serializeError(entry);
		}
		if (typeof entry === "string") {
			return maskPiiInString(entry, maskPiiEnabled);
		}
		return entry;
	});
}

const requestStore = new AsyncLocalStorage<{ requestId: string }>();

/**
 * Run `fn` with `requestId` available to every logger.* call inside it (including
 * inside async work), so handlers do not need to thread requestId through DI.
 * Call this at the Lambda handler entry point with `context.awsRequestId`.
 */
export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
	return requestStore.run({ requestId }, fn);
}

function buildEntry(
	level: LogLevel,
	message: string,
	context: LogContext | undefined,
	error: unknown | undefined,
	maskPiiEnabled: boolean,
): LogEntry {
	const maskedContext = context ? maskPiiInContext(context, maskPiiEnabled) : undefined;
	const { requestId, ...rest } = maskedContext ?? {};
	const entry: LogEntry = {
		timestamp: new Date().toISOString(),
		level,
		message,
	};

	const ambientRequestId = requestStore.getStore()?.requestId;
	const effectiveRequestId = requestId ?? ambientRequestId;
	if (effectiveRequestId) {
		entry.requestId = effectiveRequestId;
	}
	if (Object.keys(rest).length > 0) {
		entry.context = rest;
	}
	if (error !== undefined) {
		entry.error = serializeError(error);
	}

	return entry;
}

function writeLog(level: LogLevel, message: string, context?: LogContext, error?: unknown) {
	const maskPiiEnabled = getMaskPiiEnabled();
	const entry = buildEntry(level, message, context, error, maskPiiEnabled);
	const output = safeJsonStringify(entry, maskPiiEnabled);
	const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
	stream.write(`${output}\n`);
}

type Logger = {
	debug: (message: string, context?: LogContext) => void;
	info: (message: string, context?: LogContext, error?: unknown) => void;
	warn: (message: string, context?: LogContext, error?: unknown) => void;
	error: (message: string, context?: LogContext, error?: unknown) => void;
};

export function createLogger(baseContext: LogContext = {}): Logger {
	return {
		debug(message, context) {
			writeLog("debug", message, { ...baseContext, ...context });
		},
		info(message, context, error) {
			writeLog("info", message, { ...baseContext, ...context }, error);
		},
		warn(message, context, error) {
			writeLog("warn", message, { ...baseContext, ...context }, error);
		},
		error(message, context, error) {
			writeLog("error", message, { ...baseContext, ...context }, error);
		},
	};
}
