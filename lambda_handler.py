import json
import logging
import os
from datetime import datetime, timezone

import boto3

from schedule_tasks import run_scheduler

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ssm = boto3.client("ssm")
_sns = boto3.client("sns")


def get_api_key():
    response = ssm.get_parameter(
        Name=os.environ["SSM_PARAMETER_NAME"],
        WithDecryption=True,
    )
    return response["Parameter"]["Value"]


def publish_alert(*, context, severity, title, message, details=None):
    topic_arn = os.environ.get("ALERT_TOPIC_ARN")
    if not topic_arn:
        return
    subject = f"[{severity}] todoist-backlog-scheduler: {title}"[:100]
    body = "\n".join([
        f"Source:      todoist-backlog-scheduler",
        f"Function:    {context.function_name}",
        f"Severity:    {severity}",
        f"Timestamp:   {datetime.now(timezone.utc).isoformat()}",
        f"Request ID:  {context.aws_request_id}",
        f"Git SHA:     {os.environ.get('GIT_SHA', 'unknown')}",
        f"Log Group:   {context.log_group_name}",
        "",
        message,
        *([f"\nDetails:\n{json.dumps(details, indent=2)}"] if details else []),
    ])
    try:
        _sns.publish(
            TopicArn=topic_arn,
            Subject=subject,
            Message=body,
        )
    except Exception as err:
        logger.error("publish_alert failed: %s", err)


def handler(event, context):
    try:
        api_key = get_api_key()
        os.environ["TODOIST_API_KEY"] = api_key
        result = run_scheduler(api_key=api_key)
        logger.info(json.dumps({"status": "success", **result}))
        return {"statusCode": 200, "body": json.dumps(result)}
    except Exception as err:
        logger.exception("Scheduler failed")
        publish_alert(
            context=context,
            severity="error",
            title="Scheduler failed",
            message=str(err),
            details={"event": event},
        )
        raise
