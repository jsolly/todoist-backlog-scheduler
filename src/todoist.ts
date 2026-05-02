const API_BASE = "https://api.todoist.com/api/v1";

export type TodoistTask = {
	id: string;
	content: string;
};

type FilterTasksPage = {
	results: TodoistTask[];
	next_cursor: string | null;
};

type UserResponse = {
	start_day: number;
};

export class TodoistApiError extends Error {
	override readonly name = "TodoistApiError";
	constructor(
		readonly method: string,
		readonly path: string,
		readonly status: number,
	) {
		super(`Todoist ${method} ${path} -> ${status}`);
	}
}

export class TodoistClient {
	constructor(private readonly token: string) {}

	private async request<T>(path: string, init?: RequestInit): Promise<T> {
		const method = init?.method ?? "GET";
		const response = await fetch(`${API_BASE}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
				...(init?.headers ?? {}),
			},
		});
		if (!response.ok) {
			throw new TodoistApiError(method, path, response.status);
		}
		return response.json() as Promise<T>;
	}

	async getStartDay(): Promise<number> {
		const user = await this.request<UserResponse>("/user");
		return user.start_day;
	}

	async filterTasks(query: string): Promise<TodoistTask[]> {
		const tasks: TodoistTask[] = [];
		let cursor: string | null = null;
		do {
			const params = new URLSearchParams({ query });
			if (cursor) {
				params.set("cursor", cursor);
			}
			const page = await this.request<FilterTasksPage>(`/tasks/filter?${params.toString()}`);
			tasks.push(...page.results);
			cursor = page.next_cursor;
		} while (cursor);
		return tasks;
	}

	async updateTaskDueString(taskId: string, dueString: string): Promise<void> {
		await this.request(`/tasks/${taskId}`, {
			method: "POST",
			body: JSON.stringify({ due_string: dueString }),
		});
	}
}
