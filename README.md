# Todoist Backlog Scheduler
## Introduction
The Smart Schedule feature was a valuable asset in Todoist that helped many users efficiently manage their backlog of tasks. However, about three years ago, Todoist discontinued this feature, labeling it as 'overly complex' and not widely used.

In an attempt to recreate the benefits of Smart Schedule, I've crafted a succinct Python script. Its core objective is to distribute undated tasks to days with fewer scheduled activities. The script interacts with Todoist to identify tasks under the 'no date' filter. It then thoughtfully allocates these tasks across the upcoming week, taking into account the number of tasks already scheduled for each day.

For example, if you've set your 'week start day' to 'Monday' in the Todoist settings:

Running this script will evenly distribute all your undated tasks from the following Monday through to the following Sunday.

If this project aligns with your interests and you'd like to contribute or propose additional features, I'm open to any collaborative efforts.

## Installation
1. Clone this repository
2. run these commands in the root directory of the project.
```shell
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Setup
1. Rename `sample.env` to .env and add your Todoist key, which is in the [integration settings view](https://todoist.com/prefs/integrations) (Developer Tab) of your Todoist app.
2. You can manually run the script like this in the terminal
```shell
python3 schedule_tasks.py
```
  - I have also added a Github Actions file inside .github/workflows that will run the script every Sunday at 9PM. You can change the schedule by editing the cron expression in the file. If you want to go this route, add your TODOIST_API_KEY to your workflow secrets.
