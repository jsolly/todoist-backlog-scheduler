import { createLogger } from "./shared/logging.ts";
import { getTodoistApiKey } from "./shared/secrets.ts";
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
	maxPerDay?: number,
): Promise<void> {
	if (tasks.length === 0) {
		return;
	}

	const weekStart = upcomingWeekStart(now, weekStartDay);

	if (maxPerDay === undefined) {
		const buckets: DayBucket[] = Array.from(
			await countExistingTasksByDay(client, weekStart),
			([date, count]) => ({ date, count }),
		);
		for (const task of tasks) {
			buckets.sort(lightestFirst);
			const target = buckets[0] as DayBucket;
			try {
				await client.updateTaskDueString(task.id, `On ${target.date}`);
			} catch (error) {
				logger.error(
					"Failed to update task due date",
					{ taskId: task.id, targetDate: target.date, failurePhase: "todoist-update" },
					error,
				);
				throw error;
			}
			target.count += 1;
		}
		return;
	}

	if (maxPerDay <= 0) {
		throw new Error(`maxPerDay must be a positive integer, got ${maxPerDay}`);
	}

	const sorted = [...tasks].sort((a, b) => {
		const aTime = Date.parse(a.created_at) || 0;
		const bTime = Date.parse(b.created_at) || 0;
		return aTime - bTime;
	});
	let remaining = sorted;
	let weekNum = 0;

	while (remaining.length > 0) {
		const start = addDays(weekStart, weekNum * 7);
		const buckets: DayBucket[] = Array.from(
			await countExistingTasksByDay(client, start),
			([date, count]) => ({ date, count }),
		);

		const capacity = buckets.reduce((sum, b) => sum + Math.max(0, maxPerDay - b.count), 0);
		if (capacity === 0) {
			weekNum++;
			continue;
		}

		const batch = remaining.slice(0, capacity);
		remaining = remaining.slice(capacity);

		let taskIdx = 0;
		let tasksLeft = batch.length;
		let daysLeft = buckets.filter((b) => b.count < maxPerDay).length;

		for (const bucket of buckets) {
			const available = maxPerDay - bucket.count;
			if (available <= 0) continue;
			const allocation = Math.min(available, Math.ceil(tasksLeft / daysLeft));
			for (let i = 0; i < allocation && taskIdx < batch.length; i++) {
				const task = batch[taskIdx++]!;
				try {
					await client.updateTaskDueString(task.id, `On ${bucket.date}`);
				} catch (error) {
					logger.error(
						"Failed to update task due date",
						{
							taskId: task.id,
							targetDate: bucket.date,
							failurePhase: "todoist-update",
						},
						error,
					);
					throw error;
				}
			}
			tasksLeft -= allocation;
			daysLeft--;
			if (tasksLeft <= 0) break;
		}

		// `ceil(tasksLeft/daysLeft)` allocation can under-place when later buckets
		// are constrained (Sun has fewer free slots than its proportional share).
		// Reinsert anything we couldn't place this week so it overflows naturally.
		if (taskIdx < batch.length) {
			remaining = [...batch.slice(taskIdx), ...remaining];
		}

		weekNum++;
	}
}

export async function runScheduler(now: Date = new Date()): Promise<SchedulerResult> {
	const apiKey = await getTodoistApiKey();
	const client = new TodoistClient(apiKey);
	const tasks = await client.filterTasks("no date");

	if (tasks.length === 0) {
		const message = "No tasks with no date found to distribute.";
		logger.info(message);
		return { message, tasksDistributed: 0 };
	}

	const weekStartDay = await client.getStartDay();
	const parsed = Number(process.env.MAX_TASKS_PER_DAY);
	const maxPerDay = parsed > 0 ? parsed : undefined;
	const taskCount = tasks.length;
	try {
		await distributeTasks(client, tasks, weekStartDay, now, maxPerDay);
	} catch (error) {
		if (error instanceof Error) {
			(error as Error & { taskCount?: number }).taskCount = taskCount;
		}
		throw error;
	}

	const message = `Successfully distributed ${tasks.length} tasks starting from the next week.`;
	logger.info("scheduler complete", { tasksDistributed: tasks.length, weekStartDay });
	return { message, tasksDistributed: tasks.length };
}
