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
				created_at: `${date}T00:00:00Z`,
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
			{ id: "6789432105", content: "draft Q3 review", created_at: "2024-01-01T10:00:00Z" },
			{ id: "6789432106", content: "renew passport", created_at: "2024-01-02T10:00:00Z" },
			{ id: "6789432107", content: "submit expense report", created_at: "2024-01-03T10:00:00Z" },
			{ id: "6789432108", content: "schedule dentist", created_at: "2024-01-04T10:00:00Z" },
			{ id: "6789432109", content: "update resume", created_at: "2024-01-05T10:00:00Z" },
			{ id: "6789432110", content: "research summer camps", created_at: "2024-01-06T10:00:00Z" },
			{
				id: "6789432111",
				content: "buy birthday gift for Mia",
				created_at: "2024-01-07T10:00:00Z",
			},
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
			{ id: "7012345601", content: "review pull request", created_at: "2024-01-01T10:00:00Z" },
			{
				id: "7012345602",
				content: "draft launch announcement",
				created_at: "2024-01-02T10:00:00Z",
			},
			{
				id: "7012345603",
				content: "respond to recruiter ping",
				created_at: "2024-01-03T10:00:00Z",
			},
		];
		await distributeTasks(client, tasks, 1, new Date("2024-01-07T15:00:00Z"));

		const assigned = [...dueOn.values()].sort();
		expect(assigned).toEqual(["2024-01-09", "2024-01-11", "2024-01-13"]);
	});

	it("respects a Sunday-start week setting and lands tasks on distinct days starting that Sunday", async () => {
		const { client, dueOn } = makeFakeClient({ startDay: 7 });
		const tasks: TodoistTask[] = [
			{ id: "7234567801", content: "weekly review", created_at: "2024-03-10T10:00:00Z" },
			{ id: "7234567802", content: "meal plan", created_at: "2024-03-11T10:00:00Z" },
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

	it("with cap=5 and 5 tasks on an empty week, front-loads Mon-Fri at 1 each and leaves Sat/Sun empty", async () => {
		const { client, dueOn } = makeFakeClient({});
		const tasks: TodoistTask[] = [
			{ id: "8123456701", content: "draft Q3 review", created_at: "2024-01-01T10:00:00Z" },
			{ id: "8123456702", content: "renew passport", created_at: "2024-01-02T10:00:00Z" },
			{ id: "8123456703", content: "submit expense report", created_at: "2024-01-03T10:00:00Z" },
			{ id: "8123456704", content: "schedule dentist", created_at: "2024-01-04T10:00:00Z" },
			{ id: "8123456705", content: "update resume", created_at: "2024-01-05T10:00:00Z" },
		];
		await distributeTasks(client, tasks, 1, new Date("2024-01-07T15:00:00Z"), 5);

		const week = dateRange("2024-01-08", 7);
		expect(dueOn.size).toBe(5);
		// Mon (2024-01-08) through Fri (2024-01-12) each have exactly 1 task; Sat/Sun empty.
		for (const date of week.slice(0, 5)) {
			expect([...dueOn.values()].filter((d) => d === date)).toHaveLength(1);
		}
		expect([...dueOn.values()].filter((d) => d === week[5])).toHaveLength(0);
		expect([...dueOn.values()].filter((d) => d === week[6])).toHaveLength(0);
	});

	it("with cap=5 and a 35-task backlog, fills every day to the cap with no overflow", async () => {
		const { client, dueOn } = makeFakeClient({});
		const base = new Date("2023-12-01T00:00:00Z").getTime();
		const tasks: TodoistTask[] = Array.from({ length: 35 }, (_unused, i) => ({
			id: `812345${(7000 + i).toString().padStart(4, "0")}`,
			content: `backlog item ${i + 1}`,
			created_at: new Date(base + i * 3_600_000).toISOString(),
		}));
		await distributeTasks(client, tasks, 1, new Date("2024-01-07T15:00:00Z"), 5);

		const week1 = dateRange("2024-01-08", 7);
		expect(dueOn.size).toBe(35);
		for (const date of week1) {
			expect([...dueOn.values()].filter((d) => d === date)).toHaveLength(5);
		}
	});

	it("with cap=5 and 40 tasks, fills week 1 to 35 then overflows the 5 newest to week 2", async () => {
		const { client, dueOn } = makeFakeClient({});
		// Strictly monotonic `created_at` (1 hour apart) so the 5 newest are unambiguously tasks 35-39.
		const base = new Date("2023-12-01T00:00:00Z").getTime();
		const tasks: TodoistTask[] = Array.from({ length: 40 }, (_unused, i) => ({
			id: `91234567${i.toString().padStart(2, "0")}`,
			content: `backlog item ${i + 1}`,
			created_at: new Date(base + i * 3_600_000).toISOString(),
		}));
		await distributeTasks(client, tasks, 1, new Date("2024-01-07T15:00:00Z"), 5);

		const week1 = dateRange("2024-01-08", 7);
		const week2 = dateRange("2024-01-15", 7);
		const week1Ids = [...dueOn.entries()].filter(([, d]) => week1.includes(d)).map(([id]) => id);
		const week2Ids = [...dueOn.entries()].filter(([, d]) => week2.includes(d)).map(([id]) => id);

		expect(week1Ids).toHaveLength(35);
		expect(week2Ids).toHaveLength(5);
		for (const date of week1) {
			expect([...dueOn.values()].filter((d) => d === date)).toHaveLength(5);
		}
		// Oldest 35 land in week 1; newest 5 overflow.
		const oldestThirtyFive = tasks.slice(0, 35).map((t) => t.id);
		const newestFive = tasks.slice(35).map((t) => t.id);
		expect(week1Ids.sort()).toEqual(oldestThirtyFive.sort());
		expect(week2Ids.sort()).toEqual(newestFive.sort());
	});

	it("places every task even when a partially-full bucket leaves the ceil() allocation short", async () => {
		// Regression: cap=5, Sunday already has 3 existing tasks. Week capacity = 35-3 = 32.
		// Naive ceil(remaining/daysLeft) allocation under-places by 2 because Sun can't absorb
		// its proportional share. Every task must still land — overflow to week 2 if needed.
		const { client, dueOn } = makeFakeClient({
			existingByDate: { "2024-01-14": 3 },
		});
		const tasks: TodoistTask[] = Array.from({ length: 32 }, (_unused, i) => ({
			id: `73214568${i.toString().padStart(2, "0")}`,
			content: `Sarah's backlog item ${i + 1}`,
			created_at: `2024-01-${String((i % 7) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
		}));
		await distributeTasks(client, tasks, 1, new Date("2024-01-07T15:00:00Z"), 5);

		const week1 = dateRange("2024-01-08", 7);
		const week2 = dateRange("2024-01-15", 7);
		const inWeek1 = [...dueOn.values()].filter((d) => week1.includes(d));
		const inWeek2 = [...dueOn.values()].filter((d) => week2.includes(d));

		expect(dueOn.size).toBe(32); // No tasks dropped.
		expect(inWeek1.length + inWeek2.length).toBe(32);
		// Sunday (2024-01-14) reaches its cap of 5: 3 existing + 2 new.
		// The 3 existing are part of makeFakeClient's filterTasks response, not dueOn, so check
		// that we added at most 2 to Sun.
		const newOnSunday = [...dueOn.values()].filter((d) => d === "2024-01-14");
		expect(newOnSunday.length).toBeLessThanOrEqual(2);
	});

	it("overflows tasks to the next week when daily cap is reached", async () => {
		const { client, dueOn } = makeFakeClient({});
		const tasks: TodoistTask[] = [
			{ id: "1", content: "task A", created_at: "2024-01-01T10:00:00Z" },
			{ id: "2", content: "task B", created_at: "2024-01-02T10:00:00Z" },
			{ id: "3", content: "task C", created_at: "2024-01-03T10:00:00Z" },
			{ id: "4", content: "task D", created_at: "2024-01-04T10:00:00Z" },
			{ id: "5", content: "task E", created_at: "2024-01-05T10:00:00Z" },
			{ id: "6", content: "task F", created_at: "2024-01-06T10:00:00Z" },
			{ id: "7", content: "task G", created_at: "2024-01-06T11:00:00Z" },
			{ id: "8", content: "task H", created_at: "2024-01-06T12:00:00Z" },
			{ id: "9", content: "task I", created_at: "2024-01-07T10:00:00Z" },
			{ id: "10", content: "task J", created_at: "2024-01-07T11:00:00Z" },
		];
		// maxPerDay=1 → week 1 fits 7 tasks, 3 overflow to week 2
		await distributeTasks(client, tasks, 1, new Date("2024-01-07T15:00:00Z"), 1);

		const week1 = dateRange("2024-01-08", 7);
		const week2 = dateRange("2024-01-15", 7);
		const inWeek1 = [...dueOn.entries()].filter(([, d]) => week1.includes(d));
		const inWeek2 = [...dueOn.entries()].filter(([, d]) => week2.includes(d));

		expect(inWeek1).toHaveLength(7);
		expect(inWeek2).toHaveLength(3);
		// Each day in week 1 has exactly 1 task
		for (const date of week1) {
			expect([...dueOn.values()].filter((d) => d === date)).toHaveLength(1);
		}
	});

	it("schedules older tasks in the earlier week and newer tasks in the later week", async () => {
		const { client, dueOn } = makeFakeClient({});
		// 9 tasks fed out of created_at order to verify oldest-first sorting + overflow
		const allTasks: TodoistTask[] = [
			{ id: "new-1", content: "newest", created_at: "2024-01-09T10:00:00Z" },
			{ id: "old-1", content: "oldest", created_at: "2024-01-01T10:00:00Z" },
			{ id: "old-2", content: "second oldest", created_at: "2024-01-02T10:00:00Z" },
			{ id: "old-3", content: "third oldest", created_at: "2024-01-03T10:00:00Z" },
			{ id: "old-4", content: "fourth oldest", created_at: "2024-01-04T10:00:00Z" },
			{ id: "old-5", content: "fifth oldest", created_at: "2024-01-05T10:00:00Z" },
			{ id: "old-6", content: "sixth oldest", created_at: "2024-01-06T10:00:00Z" },
			{ id: "old-7", content: "seventh oldest", created_at: "2024-01-07T10:00:00Z" },
			{ id: "new-2", content: "second newest", created_at: "2024-01-08T10:00:00Z" },
		];
		await distributeTasks(client, allTasks, 1, new Date("2024-01-07T15:00:00Z"), 1);

		const week1 = dateRange("2024-01-08", 7);
		const week2 = dateRange("2024-01-15", 7);
		const week1TaskIds = [...dueOn.entries()]
			.filter(([, d]) => week1.includes(d))
			.map(([id]) => id);
		const week2TaskIds = [...dueOn.entries()]
			.filter(([, d]) => week2.includes(d))
			.map(([id]) => id);

		// The 7 oldest tasks should be in week 1
		expect(week1TaskIds.sort()).toEqual(
			["old-1", "old-2", "old-3", "old-4", "old-5", "old-6", "old-7"].sort(),
		);
		// The 2 newest tasks should overflow to week 2
		expect(week2TaskIds.sort()).toEqual(["new-1", "new-2"].sort());
	});

	it("existing tasks count toward the daily cap", async () => {
		const { client, dueOn } = makeFakeClient({
			existingByDate: {
				"2024-01-08": 2,
				"2024-01-09": 2,
				"2024-01-10": 2,
				"2024-01-11": 2,
				"2024-01-12": 2,
				"2024-01-13": 2,
				"2024-01-14": 1,
			},
		});
		const tasks: TodoistTask[] = [
			{ id: "1", content: "only one fits", created_at: "2024-01-01T10:00:00Z" },
			{ id: "2", content: "overflows", created_at: "2024-01-02T10:00:00Z" },
		];
		// cap=2 → only Sunday (count=1) has room for 1 task; second overflows to week 2
		await distributeTasks(client, tasks, 1, new Date("2024-01-07T15:00:00Z"), 2);

		const week1 = dateRange("2024-01-08", 7);
		const week2 = dateRange("2024-01-15", 7);
		const inWeek1 = [...dueOn.entries()].filter(([, d]) => week1.includes(d));
		const inWeek2 = [...dueOn.entries()].filter(([, d]) => week2.includes(d));

		expect(inWeek1).toHaveLength(1);
		expect(inWeek1[0]![0]).toBe("1"); // older task gets week 1
		expect(inWeek2).toHaveLength(1);
		expect(inWeek2[0]![0]).toBe("2"); // newer task overflows
	});

	it("spreads overflow across three weeks when backlog is very large", async () => {
		const { client, dueOn } = makeFakeClient({});
		const tasks: TodoistTask[] = Array.from({ length: 16 }, (_unused, i) => ({
			id: `t-${i}`,
			content: `task ${i}`,
			created_at: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
		}));
		// cap=1 → 7/week, so 16 tasks needs 3 weeks (7+7+2)
		await distributeTasks(client, tasks, 1, new Date("2024-01-07T15:00:00Z"), 1);

		const week1 = dateRange("2024-01-08", 7);
		const week2 = dateRange("2024-01-15", 7);
		const week3 = dateRange("2024-01-22", 7);
		const inWeek1 = [...dueOn.values()].filter((d) => week1.includes(d));
		const inWeek2 = [...dueOn.values()].filter((d) => week2.includes(d));
		const inWeek3 = [...dueOn.values()].filter((d) => week3.includes(d));

		expect(inWeek1).toHaveLength(7);
		expect(inWeek2).toHaveLength(7);
		expect(inWeek3).toHaveLength(2);
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
		const previousSsmParam = process.env.TODOIST_API_KEY_SSM_PARAM;
		delete process.env.TODOIST_API_KEY;
		// Also clear the SSM param name so getTodoistApiKey throws locally instead
		// of attempting a real SSM fetch if some env/CI has it set.
		delete process.env.TODOIST_API_KEY_SSM_PARAM;
		try {
			await expect(runScheduler()).rejects.toThrow(/TODOIST_API_KEY/);
		} finally {
			if (previous !== undefined) {
				process.env.TODOIST_API_KEY = previous;
			}
			if (previousSsmParam !== undefined) {
				process.env.TODOIST_API_KEY_SSM_PARAM = previousSsmParam;
			}
		}
	});
});
