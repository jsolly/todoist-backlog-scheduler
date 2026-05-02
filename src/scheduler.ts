import { createLogger } from "./shared/logging.ts";
import { TodoistClient, type TodoistTask } from "./todoist.ts";

const logger = createLogger({ job: "todoist-backlog-scheduler" });

export type SchedulerResult = {
	message: string;
	tasksDistributed: number;
};

function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

// Returns the next occurrence of weekStartDay (1=Monday..7=Sunday, Todoist
// convention). When today already is weekStartDay, returns today — i.e. "the
// upcoming week beginning weekStartDay", not "next week".
function upcomingWeekStart(today: Date, weekStartDay: number): Date {
	const todayWeekday = (today.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
	const daysUntilStart = (weekStartDay - 1 - todayWeekday + 7) % 7;
	return addDays(today, daysUntilStart);
}

async function countExistingTasksByDay(
	client: TodoistClient,
	weekStart: Date,
): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	for (let i = 0; i < 7; i++) {
		const date = formatDate(addDays(weekStart, i));
		const tasks = await client.filterTasks(`Due on ${date}`);
		counts.set(date, tasks.length);
	}
	return counts;
}

type DayBucket = { date: string; count: number };

function lightestFirst(a: DayBucket, b: DayBucket): number {
	return a.count - b.count || a.date.localeCompare(b.date);
}

export async function distributeTasks(
	client: TodoistClient,
	tasks: TodoistTask[],
	weekStartDay: number,
	now: Date = new Date(),
): Promise<void> {
	if (tasks.length === 0) {
		return;
	}
	const weekStart = upcomingWeekStart(now, weekStartDay);
	const buckets: DayBucket[] = Array.from(
		await countExistingTasksByDay(client, weekStart),
		([date, count]) => ({ date, count }),
	);

	for (const task of tasks) {
		buckets.sort(lightestFirst);
		const target = buckets[0] as DayBucket;
		await client.updateTaskDueString(task.id, `On ${target.date}`);
		target.count += 1;
	}
}

export async function runScheduler(now: Date = new Date()): Promise<SchedulerResult> {
	const apiKey = process.env.TODOIST_API_KEY;
	if (!apiKey) {
		throw new Error("TODOIST_API_KEY not configured");
	}
	const client = new TodoistClient(apiKey);
	const tasks = await client.filterTasks("no date");

	if (tasks.length === 0) {
		const message = "No tasks with no date found to distribute.";
		logger.info(message);
		return { message, tasksDistributed: 0 };
	}

	const weekStartDay = await client.getStartDay();
	await distributeTasks(client, tasks, weekStartDay, now);

	const message = `Successfully distributed ${tasks.length} tasks across the next week.`;
	logger.info("scheduler complete", { tasksDistributed: tasks.length, weekStartDay });
	return { message, tasksDistributed: tasks.length };
}
