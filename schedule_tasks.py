import heapq
import os
import dotenv
from todoist_api_python.api import TodoistAPI

dotenv.load_dotenv()


def get_tasks(api, filter):
    try:
        return api.get_tasks(filter=filter)
    except Exception as error:
        print(error)


def distribute_tasks(api, tasks):
    week_task_dict = {
        "Monday": 0,
        "Tuesday": 0,
        "Wednesday": 0,
        "Thursday": 0,
        "Friday": 0,
        "Saturday": 0,
        "Sunday": 0,
    }
    for day in week_task_dict.keys():
        filter = f"Due this {day}"
        if day == "Sunday":
            filter = "Due next Sunday"

        # Assign the task count for each day of next week
        week_task_dict[day] = len(get_tasks(api, filter=filter))

    week_task_heap = [(count, day) for day, count in week_task_dict.items()]
    heapq.heapify(week_task_heap)

    # Assign tasks to the day with the lowest task count. Repeat until all tasks are assigned.
    for task in tasks:
        # Pop and return the smallest item from the heap
        count, day = heapq.heappop(week_task_heap)
        due_string = f"This {day}"
        if day == "Sunday":
            due_string = "Next Sunday"
        api.update_task(task.id, due_string=due_string)
        count += 1
        # Push the new task count back into the heap with one additional task
        heapq.heappush(week_task_heap, (count, day))
    return


if __name__ == "__main__":
    """
    This script will attempt to evently distribute all tasks with no due date to the following week. 
    Run this every Sunday to distribute tasks for the next week.
    """
    TODOIST_API_KEY = os.getenv("TODOIST_API_KEY")
    api = TodoistAPI(TODOIST_API_KEY)
    tasks = get_tasks(api, "no date")
    if tasks:
        distribute_tasks(api, tasks)
