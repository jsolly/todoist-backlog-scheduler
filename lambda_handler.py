import json
import logging
import os
import time

import boto3

from schedule_tasks import run_scheduler

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ssm = boto3.client("ssm")

MAX_RETRIES = 3


def get_api_key():
    response = ssm.get_parameter(
        Name=os.environ["SSM_PARAMETER_NAME"],
        WithDecryption=True,
    )
    return response["Parameter"]["Value"]


def handler(event, context):
    api_key = get_api_key()

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            result = run_scheduler(api_key=api_key)
            logger.info("Scheduler complete: distributed %d tasks", result["tasks_distributed"])
            return {"statusCode": 200, "body": json.dumps(result)}
        except Exception as err:
            if attempt < MAX_RETRIES:
                logger.warning("Scheduler attempt %d/%d failed: %s", attempt, MAX_RETRIES, err)
                time.sleep(2 ** attempt)
            else:
                logger.error("Scheduler failed after %d attempts: %s", MAX_RETRIES, err, exc_info=True)
                raise
