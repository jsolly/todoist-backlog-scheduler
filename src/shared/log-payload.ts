/**
 * Bounded, redacted payload shaping for structured log context.
 * Distributed to consumer repos by ~/code/family-memory/scripts/sync-shared-logger.sh.
 * Pinned by tests/log-payload.test.ts (also synced).
 */
const DEFAULT_MAX_FULL_BYTES = 4096;
const DEFAULT_MAX_PREVIEW_BYTES = 8192;
const DEFAULT_MAX_STRING_CHARS = 500;

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

function isPhoneKey(key: string): boolean {
	const lower = key.toLowerCase();
	return lower.includes("phone") || lower === "countrycode" || lower === "country_code";
}

function getMaskPiiEnabled(): boolean {
	return process.env.LOG_MASK_PII?.toLowerCase() !== "false";
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

function redactedJsonStringify(value: unknown, maskPiiEnabled: boolean): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(value, (key, entry) => {
		if (key !== "" && (isSensitiveKey(key) || (maskPiiEnabled && isPhoneKey(key)))) {
			return "[REDACTED]";
		}
		if (typeof entry === "bigint") {
			return entry.toString();
		}
		if (typeof entry === "string") {
			return maskPiiInString(entry, maskPiiEnabled);
		}
		if (typeof entry === "object" && entry !== null) {
			if (seen.has(entry)) {
				return "[Circular]";
			}
			seen.add(entry);
		}
		return entry;
	});
}

function utf8ByteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function truncateText(text: string, maxBytes: number, headTail: boolean): string {
	if (utf8ByteLength(text) <= maxBytes) {
		return text;
	}
	if (!headTail) {
		let end = text.length;
		while (end > 0 && utf8ByteLength(text.slice(0, end)) > maxBytes) {
			end -= 1;
		}
		return `${text.slice(0, end)}…`;
	}
	const half = Math.floor(maxBytes / 2);
	let headEnd = Math.min(text.length, Math.floor(half / 2));
	while (headEnd > 0 && utf8ByteLength(text.slice(0, headEnd)) > half) {
		headEnd -= 1;
	}
	let tailStart = text.length;
	while (tailStart > headEnd && utf8ByteLength(text.slice(tailStart)) > half) {
		tailStart += 1;
	}
	return `${text.slice(0, headEnd)}…${text.slice(tailStart)}`;
}

type PreparedLogPayload =
	| {
			mode: "full";
			byteLength: number;
			value: unknown;
	  }
	| {
			mode: "preview";
			byteLength: number;
			omittedBytes: number;
			preview: string;
			encoding: "json" | "text";
	  }
	| {
			mode: "omitted";
			byteLength: number;
			reason: "unserializable" | "empty";
	  };

type PreparePayloadForLogOptions = {
	maxFullBytes?: number;
	maxPreviewBytes?: number;
	maxStringChars?: number;
	headTail?: boolean;
};

export function preparePayloadForLog(
	input: unknown,
	options?: PreparePayloadForLogOptions,
): PreparedLogPayload {
	const maxFullBytes = options?.maxFullBytes ?? DEFAULT_MAX_FULL_BYTES;
	const maxPreviewBytes = options?.maxPreviewBytes ?? DEFAULT_MAX_PREVIEW_BYTES;
	const maxStringChars = options?.maxStringChars ?? DEFAULT_MAX_STRING_CHARS;
	const headTail = options?.headTail ?? true;
	const maskPiiEnabled = getMaskPiiEnabled();

	if (input === undefined || input === null) {
		return { mode: "omitted", byteLength: 0, reason: "empty" };
	}

	if (typeof input === "string") {
		const masked = maskPiiInString(input, maskPiiEnabled);
		const byteLength = utf8ByteLength(masked);
		if (byteLength <= maxFullBytes) {
			return { mode: "full", byteLength, value: masked };
		}
		const preview = truncateText(masked, maxPreviewBytes, headTail);
		return {
			mode: "preview",
			byteLength,
			omittedBytes: byteLength - utf8ByteLength(preview),
			preview: truncateText(preview, maxStringChars, false),
			encoding: "text",
		};
	}

	let serialized: string;
	try {
		serialized = redactedJsonStringify(input, maskPiiEnabled);
	} catch {
		return { mode: "omitted", byteLength: 0, reason: "unserializable" };
	}

	if (serialized === undefined || serialized === "undefined") {
		return { mode: "omitted", byteLength: 0, reason: "unserializable" };
	}

	const byteLength = utf8ByteLength(serialized);
	if (byteLength <= maxFullBytes) {
		try {
			return { mode: "full", byteLength, value: JSON.parse(serialized) as unknown };
		} catch {
			return { mode: "full", byteLength, value: serialized };
		}
	}

	const preview = truncateText(serialized, maxPreviewBytes, headTail);
	return {
		mode: "preview",
		byteLength,
		omittedBytes: byteLength - utf8ByteLength(preview),
		preview,
		encoding: "json",
	};
}

export function payloadLogFields(
	prepared: PreparedLogPayload,
	label = "payload",
): Record<string, unknown> {
	const prefix = label;
	if (prepared.mode === "full") {
		return {
			[`${prefix}Mode`]: "full",
			[`${prefix}ByteLength`]: prepared.byteLength,
			[prefix]: prepared.value,
		};
	}
	if (prepared.mode === "preview") {
		return {
			[`${prefix}Mode`]: "preview",
			[`${prefix}ByteLength`]: prepared.byteLength,
			[`${prefix}OmittedBytes`]: prepared.omittedBytes,
			[`${prefix}Preview`]: prepared.preview,
			[`${prefix}Encoding`]: prepared.encoding,
			truncated: true,
		};
	}
	return {
		[`${prefix}Mode`]: "omitted",
		[`${prefix}ByteLength`]: prepared.byteLength,
		[`${prefix}OmittedReason`]: prepared.reason,
	};
}
