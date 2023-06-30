# todoist-backlog-scheduler
This script evenly distributes all tasks with no date to the following week. So that means the tasks will be distributed to the upcoming WEEK_START_DAY and the 6 days after WEEK_START_DAY.

So let's say your WEEK_START_DAY is Monday.

You run the script on a Wednesday.

All your unscheduled tasks will be evenly distributed between Monday and Sunday of the following week.

## Motivation
In the past, the Smart Schedule was a phenomenal feature many of us heavily relied on to manage our pile of pending tasks. Regrettably, about three years ago, Todoist chose to eliminate this feature, citing it as 'overly complicated' and under-utilized.

To replicate what Smart Schedule used to offer, I've developed a concise Python Script. Its primary function is to assign undated tasks to days with lighter workloads. The script queries Todoist for tasks falling under the 'no date' filter. It then strategically assigns these tasks throughout the following week, taking into consideration the volume of tasks already allocated to specific days.

The ultimate objective is to ensure a balanced distribution of tasks for the following week.

If this initiative resonates with you and you'd like to contribute or suggest added functionalities, I welcome any form of collaboration.

## Installation
1. Clone this repository
2. Then run these commands in the root directory of the project.
```shell
$ brew install python3
$ python3 -m venv venv
$ source venv/bin/activate
$ pip install --upgrade pip
$ pip install -r requirements.txt
```

## Setup
1. Rename `sample.env` to .env and add your Todoist key, which is in the [integration settings view](https://todoist.com/prefs/integrations) (Developer Tab) of your Todoist app.
2. You can manually run the script like this in the terminal
```shell
$ python3 schedule_tasks.py
```
  - I have also added a Github Actions file inside .github/workflows that will run the script every Sunday at 9PM. You can change the schedule by editing the cron expression in the file. If you want to go this route, add your TODOIST_API_KEY to your workflow secrets.
