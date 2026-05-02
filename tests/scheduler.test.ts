import { describe, expect, it } from "vitest";
import { distributeTasks, runScheduler } from "../src/scheduler.ts";
import type { TodoistClient, TodoistTask } from "../src/todoist.ts";

type FakeTodoistClient = Pick<TodoistClient, "getStartDay" | "filterTasks" | "updateTaskDueString">;

function makeFakeClient(options: {
	existingByDate?: Record<string, number>;
	startDay?: number;
	tasksWithNoDate?: TodoistTask[];
}): { client: TodoistClient; dueOn: Map<string, string> } {
	const existing = new Map(Object.entries(options.existingByDate ?? {}));
	const dueOn = new Map<string, string>();
	const noDate = options.tasksWithNoDate ?? [];

	const fake: FakeTodoistClient = {
		async getStartDay() {
			return options.startDay ?? 1;
		},
		async filterTasks(query: string): Promise<TodoistTask[]> {
			if (query === "no date") {
				return noDate;
			}
			const match = query.match(/^Due on (\d{4}-\d{2}-\d{2})$/);
			if (!match) {
				throw new Error(`unexpected query: ${query}`);
			}
			const date = match[1] as string;
			const count = existing.get(date) ?? 0;
			return Array.from({ length: count }, (_unused, i) => ({
				id: `existing-${date}-${i}`,
				content: `existing on ${date}`,
			}));
		},
		async updateTaskDueString(taskId: string, dueString: string) {
			const match = dueString.match(/^On (\d{4}-\d{2}-\d{2})$/);
			if (!match) {
				throw new Error(`unexpected due string: ${dueString}`);
			}
			const date = match[1] as string;
			dueOn.set(taskId, date);
			existing.set(date, (existing.get(date) ?? 0) + 1);
		},
	};
	return { client: fake as TodoistClient, dueOn };
}

function dateRange(startIso: string, days: number): string[] {
	const start = new Date(`${startIso}T00:00:00Z`);
	return Array.from({ length: days }, (_unused, i) => {
		const next = new Date(start);
		next.setUTCDate(next.getUTCDate() + i);
		return next.toISOString().slice(0, 10);
	});
}

describe("Todoist backlog scheduler", () => {
	it("spreads a Sunday backlog one-per-day across an empty Mon–Sun week", async () => {
		const { client, dueOn } = makeFakeClient({});
		const tasks: TodoistTask[] = [
			{ id: "6789432105", content: "draft Q3 review" },
			{ id: "6789432106", content: "renew passport" },
			{ id: "6789432107", content: "submit expense report" },
			{ id: "6789432108", content: "schedule dentist" },
			{ id: "6789432109", content: "update resume" },
			{ id: "6789432110", content: "research summer camps" },
			{ id: "6789432111", content: "buy birthday gift for Mia" },
		];
		// 2024-01-07 is a Sunday → next Monday is 2024-01-08.
		await distributeTasks(client, tasks, 1, new Date("2024-01-07T15:00:00Z"));

		const week = dateRange("2024-01-08", 7);
		const distribution = week.map((date) => ({
			date,
			count: [...dueOn.values()].filter((d) => d === date).length,
		}));
		expect(distribution.every((d) => d.count === 1)).toBe(true);
	});

	it("piles new tasks onto the lightest existing days first", async () => {
		const { client, dueOn } = makeFakeClient({
			existingByDate: {
				"2024-01-08": 5, // Monday already busy
				"2024-01-09": 0,
				"2024-01-10": 1,
				"2024-01-11": 0,
				"2024-01-12": 4,
				"2024-01-13": 0,
				"2024-01-14": 2,
			},
		});
		const tasks: TodoistTask[] = [
			{ id: "7012345601", content: "review pull request" },
			{ id: "7012345602", content: "draft launch announcement" },
			{ id: "7012345603", content: "respond to recruiter ping" },
		];
		await distributeTasks(client, tasks, 1, new Date("2024-01-07T15:00:00Z"));

		const assigned = [...dueOn.values()].sort();
		expect(assigned).toEqual(["2024-01-09", "2024-01-11", "2024-01-13"]);
	});

	it("respects a Sunday-start week setting and lands tasks on distinct days starting that Sunday", async () => {
		const { client, dueOn } = makeFakeClient({ startDay: 7 });
		const tasks: TodoistTask[] = [
			{ id: "7234567801", content: "weekly review" },
			{ id: "7234567802", content: "meal plan" },
		];
		// Run on Wednesday 2024-03-13. Next Sunday is 2024-03-17.
		await distributeTasks(client, tasks, 7, new Date("2024-03-13T12:00:00Z"));

		const dates = [...dueOn.values()].sort();
		const weekRange = dateRange("2024-03-17", 7);
		expect(dates).toHaveLength(2);
		expect(new Set(dates).size).toBe(2);
		expect(dates.every((d) => weekRange.includes(d))).toBe(true);
		// First weekday in the assigned window is the configured Sunday start.
		expect(new Date(`${weekRange[0]}T00:00:00Z`).getUTCDay()).toBe(0);
	});

	it("scheduler run with no undated tasks leaves the week unchanged", async () => {
		const { client, dueOn } = makeFakeClient({});
		await distributeTasks(client, [], 1, new Date("2024-01-07T15:00:00Z"));
		expect(dueOn.size).toBe(0);
	});

	it("returns zero distributed when run with an empty backlog end-to-end", async () => {
		process.env.TODOIST_API_KEY = "a3f8e2c1d9b74506f8e2c1d9b74506f8e2c1d9b7";
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: Request | string | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.includes("/tasks/filter") && url.includes("no+date")) {
				return new Response(JSON.stringify({ results: [], next_cursor: null }), {
					status: 200,
				});
			}
			throw new Error(`unexpected fetch in empty-backlog test: ${url}`);
		}) as typeof fetch;
		try {
			const result = await runScheduler(new Date("2024-01-07T15:00:00Z"));
			expect(result.tasksDistributed).toBe(0);
			expect(result.message).toMatch(/no tasks/i);
		} finally {
			globalThis.fetch = realFetch;
			delete process.env.TODOIST_API_KEY;
		}
	});

	it("scheduler aborts immediately when the API key is missing", async () => {
		const previous = process.env.TODOIST_API_KEY;
		delete process.env.TODOIST_API_KEY;
		try {
			await expect(runScheduler()).rejects.toThrow(/TODOIST_API_KEY/);
		} finally {
			if (previous !== undefined) {
				process.env.TODOIST_API_KEY = previous;
			}
		}
	});
});
