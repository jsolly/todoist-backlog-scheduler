import json
import logging

from schedule_tasks import run_scheduler

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    try:
        result = run_scheduler()
    except Exception:
        logger.error("Scheduler failed", exc_info=True)
        raise
    logger.info("Scheduler complete: distributed %d tasks", result["tasks_distributed"])
    return {"statusCode": 200, "body": json.dumps(result)}
