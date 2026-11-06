"""Small JSON logging configuration using Python's standard library."""

import json
import logging
from datetime import UTC, datetime

EVENT_FIELDS = ("request_id", "method", "path", "status_code", "duration_ms", "error_type")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": record.getMessage(),
        }
        payload.update(
            {field: getattr(record, field) for field in EVENT_FIELDS if hasattr(record, field)}
        )
        return json.dumps(payload, ensure_ascii=True)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("motion_dna_api")
    logger.handlers = [handler]
    logger.setLevel(level)
    logger.propagate = False
