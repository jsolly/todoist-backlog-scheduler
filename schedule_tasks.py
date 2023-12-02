import heapq
import os
import dotenv
import requests
from todoist_api_python.api import TodoistAPI
from datetime import datetime, timedelta

dotenv.load_dotenv()

def get_start_day() -> str:
    """
    Make a GET call to the https://api.todoist.com/API/v2/user endpoint with the user's token to get the start day of the week
    that has been set in the user's Todoist settings. The start day of the week is returned as an integer where 1 is Monday and 7 is Sunday.
    """
    url = "https://api.todoist.com/API/v2/user"
    headers = {"Authorization": f"Bearer {TODOIST_API_KEY}"}
    
    response = requests.get(url, headers=headers)
    
    return response.json()["start_day"]


def get_tasks(api, filter):
    """
    Get all tasks that match the filter.
    """
    try:
        return api.get_tasks(filter=filter)
    except Exception as error:
        print(error)


def get_next_week_day_dict(week_start_day: int):
    """
    Generate a dictionary of the next week starting from week_start_day.
    It will look like something like this where 2023-10-23 is a Monday and
    2023-10-29 is a Sunday:
    {
        "2023-10-30": 1,
        "2023-10-31": 2,
        "2023-11-01": 3,
        "2023-11-02": 4,
        "2023-11-03": 5,
        "2023-11-04": 6,
        "2023-11-05": 7,
    }
    """
    

    today = datetime.now()

    # Adjust week_start_day to account for the shift from 0-based to 1-based
    adjusted_week_start_day = week_start_day - 1

    # Get the next instance of the start day of the week
    next_start_day = today + timedelta(
        (adjusted_week_start_day - today.weekday() + 7) % 7
    )

    # Generate the 7 days of next week starting from next_start_day
    next_week_days = [next_start_day + timedelta(days=i) for i in range(7)]

    # Return a dictionary where each key is a day of the next week and each value is the day of the week (1-7)
    return {day.date().strftime("%Y-%m-%d"): i + 1 for i, day in enumerate(next_week_days)}

def populate_next_week_dict_with_existing_tasks(api, next_week_day_dict):
    """
    Populate the next week day dictionary with the number of tasks that are already due on each day.
    Will return another dictionary that looks something like this:
    {
        "2023-10-30": 1,
        "2023-10-31": 2,
        "2023-11-01": 3,
        "2023-11-02": 4,
        "2023-11-03": 5,
        "2023-11-04": 6,
        "2023-11-05": 7,
    """
    for day in next_week_day_dict.keys():
        filter = f"Due on {day}"
        next_week_day_dict[day] = len(get_tasks(api, filter=filter))
    return next_week_day_dict


def distribute_tasks(api, tasks, week_start_day):
    """
    Distribute tasks evenly across the next week starting from WEEK_START_DAY taking into account existing tasks.
    """
    next_week_day_dict = get_next_week_day_dict(week_start_day)
    next_week_day_dict = populate_next_week_dict_with_existing_tasks(
        api, next_week_day_dict
    )

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
    This script will attempt to evently distribute all tasks with no due date to the following week based on the WEEK_START_DAY.
    that is set in the user's Todoist settings.
    """
    TODOIST_API_KEY = os.getenv("TODOIST_API_KEY") # Put your Todoist API key in a .env file in the same directory as this script
    API = TodoistAPI(TODOIST_API_KEY)
    WEEK_START_DAY = get_start_day()
    TASKS = get_tasks(API, "no date & !##Alexa*")
    if TASKS:
        distribute_tasks(API, TASKS, WEEK_START_DAY)
        print(f"Successfully distributed {len(TASKS)} tasks across the next week.")
