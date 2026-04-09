import json
import logging
import os

import boto3

from schedule_tasks import run_scheduler

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ssm = boto3.client("ssm")


def handler(event, context):
    response = ssm.get_parameter(
        Name=os.environ["SSM_PARAMETER_NAME"],
        WithDecryption=True,
    )
    os.environ["TODOIST_API_KEY"] = response["Parameter"]["Value"]

    try:
        result = run_scheduler()
    except Exception:
        logger.error("Scheduler failed", exc_info=True)
        raise
    logger.info("Scheduler complete: distributed %d tasks", result["tasks_distributed"])
    return {"statusCode": 200, "body": json.dumps(result)}
