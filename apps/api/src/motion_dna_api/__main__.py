"""Development server entrypoint used by the root pnpm command."""

import uvicorn

from motion_dna_api.config import Settings


def main() -> None:
    settings = Settings()
    uvicorn.run(
        "motion_dna_api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.app_env == "development",
        access_log=False,
        log_config={
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {"json": {"()": "motion_dna_api.logging.JsonFormatter"}},
            "handlers": {"default": {"class": "logging.StreamHandler", "formatter": "json"}},
            "loggers": {
                "uvicorn": {
                    "handlers": ["default"],
                    "level": settings.log_level,
                    "propagate": False,
                }
            },
        },
    )


if __name__ == "__main__":
    main()
