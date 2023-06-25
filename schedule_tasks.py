import heapq
import os
import dotenv
from todoist_api_python.api import TodoistAPI
from datetime import datetime, timedelta

dotenv.load_dotenv()

TODOIST_API_KEY = os.getenv("TODOIST_API_KEY")
WEEK_START_DAY = "Monday"


def get_tasks(api, filter):
    """
    Get all tasks that match the filter.
    """
    try:
        return api.get_tasks(filter=filter)
    except Exception as error:
        print(error)

def get_next_week_day_dict(WEEK_START_DAY):
    """
    Generate a dictionary of the next week starting from WEEK_START_DAY.
    It will look like something like this where 2021-01-04 is the day of the week that WEEK_START_DAY is set to.
    In my case, it is Monday.
    {
        "2023-26-06": 0,
        "2023-27-06": 0,
        "2023-28-06": 0,
        "2023-29-06": 0,
        "2023-30-06": 0,
        "2023-01-07": 0,
        "2023-02-07": 0,
    }
    """
    days_map = {
        "Monday": 0,
        "Tuesday": 1,
        "Wednesday": 2,
        "Thursday": 3,
        "Friday": 4,
        "Saturday": 5,
        "Sunday": 6,
    }

    today = datetime.now()

    # Get the next instance of the start day of the week
    next_start_day = today + timedelta(
        (days_map[WEEK_START_DAY] - today.weekday() + 7) % 7
    )

    # Generate the 7 days of next week starting from WEEK_START_DAY
    next_week_days = [next_start_day + timedelta(days=i) for i in range(7)]

    # Return a dictionary where each key is a day of the next week and initialize the task count to 0 (will be updated later)
    return {day.date().strftime("%Y-%m-%d"): 0 for day in next_week_days}


def populate_next_week_dict_with_existing_tasks(api, next_week_day_dict):
    """
    Populate the next week day dictionary with the number of tasks that are already due on each day.
    """
    for day in next_week_day_dict.keys():
        filter = f"Due on {day}"
        next_week_day_dict[day] = len(get_tasks(api, filter=filter))
    return next_week_day_dict


def distribute_tasks(api, tasks):
    """
    Distribute tasks evenly across the next week starting from WEEK_START_DAY taking into account existing tasks.
    """
    next_week_day_dict = get_next_week_day_dict(WEEK_START_DAY)
    next_week_day_dict = populate_next_week_dict_with_existing_tasks(api, next_week_day_dict)

    week_task_heap = [(count, day) for day, count in next_week_day_dict.items()]
    heapq.heapify(week_task_heap)

    # Assign tasks to the day with the lowest task count. Repeat until all tasks are assigned.
    for task in tasks:
        # Pop and return the smallest item from the heap
        count, day = heapq.heappop(week_task_heap)
        due_string = f"On {day}"
        api.update_task(task.id, due_string=due_string)
        count += 1
        # Push the new task count back into the heap with one additional task
        heapq.heappush(week_task_heap, (count, day))
    return


if __name__ == "__main__":
    """
    This script will attempt to evently distribute all tasks with no due date to the following week based on a
    WEEK_START_DAY.
    """

    api = TodoistAPI(TODOIST_API_KEY)
    tasks = get_tasks(api, "no date")
    if tasks:
        distribute_tasks(api, tasks)
