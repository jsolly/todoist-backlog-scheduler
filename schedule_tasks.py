# This script evenly distributes Todoist tasks that have no due date across the next week,
# starting from your Todoist-configured week start day. To use:
# 1. Create a .env file with your TODOIST_API_KEY
# 2. Run the script to automatically distribute all undated tasks

import heapq
import os
from datetime import datetime, timedelta
import dotenv
import requests
from todoist_api_python.api import TodoistAPI

dotenv.load_dotenv()

def get_start_day() -> int:
    """Get user's week start day setting from Todoist (1=Monday, 7=Sunday)."""
    response = requests.get(
        "https://api.todoist.com/API/v2/user",
        headers={"Authorization": f"Bearer {os.getenv('TODOIST_API_KEY')}"}
    )
    return response.json()["start_day"]

def get_tasks_for_week(api: TodoistAPI, start_date: datetime) -> dict[str, int]:
    """
    Get number of tasks per day for the week starting from start_date.
    Returns dict mapping date strings (YYYY-MM-DD) to task counts.
    
    Example return value:
    {
        "2023-10-30": 1,  # 1 task on Monday
        "2023-10-31": 2,  # 2 tasks on Tuesday
        "2023-11-01": 0,  # no tasks on Wednesday
        "2023-11-02": 4,  # 4 tasks on Thursday
        "2023-11-03": 1,  # 1 task on Friday
        "2023-11-04": 0,  # no tasks on Saturday
        "2023-11-05": 3   # 3 tasks on Sunday
    }
    """
    # Initialize a dict with 7 days of the week starting from start_date
    # and set the task count to 0 for each day
    week_days = {
        (start_date + timedelta(days=i)).strftime("%Y-%m-%d"): 0 
        for i in range(7)
    }
    
    # Assign the number of tasks for each day
    for date in week_days:
        tasks = api.get_tasks(filter=f"Due on {date}") # Get tasks for each day
        week_days[date] = len(tasks) if tasks else 0
        
    return week_days

def distribute_tasks(api: TodoistAPI, tasks: list, week_start_day: int) -> None:
    """Distribute tasks evenly across the next week, accounting for existing tasks."""
    if not tasks:
        return

    # Get next occurrence of start day
    today = datetime.now()
    days_until_start = (week_start_day - 1 - today.weekday() + 7) % 7
    next_week_start = today + timedelta(days=days_until_start)
    
    # Using a min heap ensures we always assign new tasks to the day with the least tasks
    week_tasks = get_tasks_for_week(api, next_week_start)
    task_heap = [(count, date) for date, count in week_tasks.items()]
    heapq.heapify(task_heap)

    # Distribute tasks to days with lowest task count
    for task in tasks:
        count, date = heapq.heappop(task_heap)
        api.update_task(task.id, due_string=f"On {date}")
        heapq.heappush(task_heap, (count + 1, date))

def main():
    """Distribute tasks with no due date evenly across next week."""
    api = TodoistAPI(os.getenv("TODOIST_API_KEY"))
    tasks = api.get_tasks(filter="no date")
    
    if tasks:
        distribute_tasks(api, tasks, get_start_day())
        print(f"Successfully distributed {len(tasks)} tasks across the next week.")

if __name__ == "__main__":
    main()
