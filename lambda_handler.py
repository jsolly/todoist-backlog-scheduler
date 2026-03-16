import json
import logging
import os

import boto3

from schedule_tasks import run_scheduler

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ssm = boto3.client("ssm")


def get_api_key():
    response = ssm.get_parameter(
        Name=os.environ["SSM_PARAMETER_NAME"],
        WithDecryption=True,
    )
    return response["Parameter"]["Value"]


def handler(event, context):
    try:
        api_key = get_api_key()
        os.environ["TODOIST_API_KEY"] = api_key
        result = run_scheduler(api_key=api_key)
        logger.info(json.dumps({"status": "success", **result}))
        return {"statusCode": 200, "body": json.dumps(result)}
    except Exception:
        logger.exception("Scheduler failed")
        raise
