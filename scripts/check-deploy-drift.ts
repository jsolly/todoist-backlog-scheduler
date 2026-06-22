#!/usr/bin/env tsx
/**
 * scripts/check-deploy-drift.ts — read-only audit that every live Lambda is
 * running code at origin/main, not a stale deploy.
 *
 * WHICH SIGNAL = AWS's own artifact fingerprint, not a self-asserted string. Each
 * deploy (aws/deploy-code.sh code-only, aws/deploy.sh after a full SAM deploy)
 * tags the function with:
 *   - Deploy-Sha256  = the CodeSha256 update-function-code/list-functions reports
 *     (base64 SHA256 of the exact zip AWS stored — server-computed, unspoofable).
 *   - Deploy-Commit  = the git commit the deploy built from.
 * This audit reads both tags AND the function's LIVE CodeSha256 in a single,
 * already-granted `aws lambda get-function` call (NOT `list-tags`, which needs an
 * un-granted lambda:ListTags), and checks two things:
 *   - INTEGRITY: live CodeSha256 == Deploy-Sha256 tag. A mismatch means the running
 *     bytes differ from what the pipeline recorded — an out-of-band edit.
 *   - IDENTITY: Deploy-Commit resolves in git history and is origin/main (or a clean
 *     ancestor) — else the deployed code is behind / diverged.
 * Replaces the old GIT_SHA env field, which went stale on every code-only deploy
 * (env vars are untouched by update-function-code).
 *
 * Fails CLOSED: aws CLI absent, fetch fails, zero functions, integrity mismatch,
 * a Deploy-Commit unknown to git / behind origin/main with runtime-code changes, or a
 * function that list-functions returned but get-function can't read (unverifiable)
 * → exit 1.
 * Reported but NOT failed: tooling/docs-only drift, and functions with no
 * Deploy-Sha256 tag yet (untagged — pre-rollout / never deployed).
 *
 * Read-only: lambda:ListFunctions + lambda:GetFunction + local git. No mutation.
 * Usage: npm run check:deploy-drift   (manual; needs AWS read creds)
 */
import { execFileSync } from "node:child_process";

const FUNCTION_PREFIX = "todoist-backlog-scheduler-";
// Runtime code spans the shared logger (src/) AND the handler (aws/src/), so behind-detection must
// consider BOTH — a stale scheduler under aws/src/ is real drift, not "docs only".
const RUNTIME_PATHS = ["src/", "aws/src/"];

function sh(cmd: string, args: string[]): string {
	return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function gitOk(args: string[]): boolean {
	try {
		execFileSync("git", args, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** Live CodeSha256 + Deploy-* tags for a function, or null if unreadable. */
function liveProvenance(
	fnName: string,
): { live: string | null; deploySha: string | null; commit: string | null } | null {
	let raw: string;
	try {
		raw = sh("aws", [
			"lambda",
			"get-function",
			"--function-name",
			fnName,
			"--query",
			"{live: Configuration.CodeSha256, tags: Tags}",
			"--output",
			"json",
		]);
	} catch {
		return null; // no function / no read access
	}
	const parsed = JSON.parse(raw) as { live: string | null; tags: Record<string, string> | null };
	const tags = parsed.tags ?? {};
	return {
		live: parsed.live,
		deploySha: tags["Deploy-Sha256"] ?? null,
		commit: tags["Deploy-Commit"] ?? null,
	};
}

function main(): void {
	try {
		sh("aws", ["--version"]);
	} catch {
		console.error("✗ aws CLI not found — install it (and authenticate) to audit deploy drift.");
		process.exit(1);
	}

	if (!gitOk(["fetch", "origin", "main", "--quiet"])) {
		console.error(
			"✗ git fetch origin main failed — refusing to audit against an unverified (possibly stale) origin/main.",
		);
		process.exit(1);
	}
	const target = sh("git", ["rev-parse", "origin/main"]);
	const targetShort = target.slice(0, 8);

	const raw = sh("aws", [
		"lambda",
		"list-functions",
		"--query",
		`Functions[?starts_with(FunctionName, '${FUNCTION_PREFIX}')].FunctionName`,
		"--output",
		"json",
	]);
	const fns = (JSON.parse(raw) as string[]).sort((a, b) => a.localeCompare(b));

	if (fns.length === 0) {
		console.error(
			`✗ no ${FUNCTION_PREFIX}* functions found — wrong account/region, or a broken read. Refusing to report "no drift".`,
		);
		process.exit(1);
	}

	console.log(`Deploy-drift audit — target origin/main = ${targetShort}\n`);

	const problems: string[] = [];
	const untagged: string[] = [];
	const unverifiable: string[] = [];
	for (const name of fns) {
		const p = liveProvenance(name);
		if (!p) {
			console.log(`  ? ${name}: get-function failed — cannot verify (no read access?)`);
			unverifiable.push(name);
			continue;
		}
		if (!p.live) {
			console.log(`  ? ${name}: get-function returned no CodeSha256 — cannot verify`);
			unverifiable.push(name);
			continue;
		}
		if (!p.deploySha || !p.commit) {
			console.log(`  ? ${name}: no Deploy-* tag yet — untagged (pre-rollout or never deployed)`);
			untagged.push(name);
			continue;
		}
		if (p.live !== p.deploySha) {
			console.log(
				`  ✗ ${name}: live CodeSha256 ≠ Deploy-Sha256 tag — out-of-band code change (console edit / off-pipeline update-function-code)`,
			);
			problems.push(name);
			continue;
		}
		const commitShort = p.commit.slice(0, 8);
		if (!gitOk(["rev-parse", "--verify", "--quiet", `${p.commit}^{commit}`])) {
			console.log(`  ✗ ${name}: Deploy-Commit ${commitShort} unknown to git history (diverged / force-push)`);
			problems.push(name);
			continue;
		}
		const commitFull = sh("git", ["rev-parse", `${p.commit}^{commit}`]);
		if (commitFull === target) {
			console.log(`  ✓ ${name}: ${commitShort} (current)`);
			continue;
		}
		if (!gitOk(["merge-base", "--is-ancestor", p.commit, target])) {
			console.log(`  ✗ ${name}: Deploy-Commit ${commitShort} is NOT an ancestor of origin/main (diverged)`);
			problems.push(name);
			continue;
		}
		const runtimeChanges = sh("git", [
			"diff",
			"--name-only",
			`${p.commit}..${target}`,
			"--",
			...RUNTIME_PATHS,
		]);
		if (runtimeChanges) {
			const files = runtimeChanges.split("\n").filter(Boolean);
			console.log(`  ✗ ${name}: ${commitShort} → ${targetShort} STALE — ${files.length} runtime file(s) undeployed:`);
			for (const f of files.slice(0, 10)) console.log(`        ${f}`);
			if (files.length > 10) console.log(`        … and ${files.length - 10} more`);
			problems.push(name);
		} else {
			console.log(`  ~ ${name}: ${commitShort} → ${targetShort} behind, but no runtime changes (tooling/docs only)`);
		}
	}

	if (untagged.length > 0) {
		console.log(`\n? ${untagged.length} function(s) untagged (no Deploy-* tag yet): ${untagged.join(", ")}`);
	}
	if (unverifiable.length > 0) {
		// Fail closed: a function that list-functions returned but get-function can't read is an
		// anomaly (transient error / partial IAM), not a clean bill of health — the audit must not
		// print "all current" while having silently skipped a function.
		console.error(
			`\n✗ ${unverifiable.length} function(s) unverifiable (in list-functions but get-function failed): ${unverifiable.join(", ")}`,
		);
	}
	if (problems.length > 0) {
		console.error(`\n✗ ${problems.length} function(s) with deploy drift: ${problems.join(", ")}`);
		console.error("  Redeploy from a credentialed laptop: npm run deploy:code.");
	}
	if (problems.length > 0 || unverifiable.length > 0) {
		process.exit(1);
	}
	console.log("\n✓ all tagged functions current (or behind only on tooling/docs).");
}

main();
