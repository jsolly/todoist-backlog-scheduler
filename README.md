# todoist-backlog-scheduler
This script is designed to be run on Sundays to evently distribute all tasks with no date to the following week (Monday to Sunday).

## Installation
1. Clone this repository
2. Install Python 3
```shell
$ brew install python3
$ python3 -m venv venv
$ source venv/bin/activate
$ pip install --upgrade pip
$ pip install -r requirements.txt
```

## Setup
1 - You can manually run the script like this in the terminal
```shell
$ python3 schedule_tasks.py
```
2 - Or you can run it on a schedule using cron or windows task scheduler
```shell
$ crontab -e
```
Add this line to the file (run every Sunday 9PM)
```shell
0 21 * * 0 /path/to/venv/bin/python3 /path/to/schedule_tasks.py
```
