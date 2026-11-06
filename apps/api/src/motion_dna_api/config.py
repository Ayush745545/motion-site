"""Validated configuration, independent of the current working directory."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _root_env() -> Path:
    # Editable installs resolve from source; built wheels can resolve from the
    # caller's monorepo directory without embedding this machine's absolute path.
    for location in (Path(__file__).resolve().parent, Path.cwd()):
        for directory in (location, *location.parents):
            if (directory / "pnpm-workspace.yaml").is_file():
                return directory / ".env"
    return Path.cwd() / ".env"


ROOT_ENV = _root_env()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_ENV,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        populate_by_name=True,
    )

    app_env: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    dna_browser_image: str = Field(
        default="motion-dna-analyzer:1", pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,200}$"
    )
    director_provider: Literal["deterministic", "local", "api"] = "deterministic"
    director_model: str = Field(default="qwen2.5:7b", min_length=1, max_length=120)
    director_url: str = "http://127.0.0.1:11434/api/chat"
    director_api_token: SecretStr = SecretStr("")
    render_storage_dir: Path = ROOT_ENV.parent / "storage" / "renders"
    source_local_mode: bool = False

    @field_validator("director_url")
    @classmethod
    def director_endpoint(cls, value):
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or (
                parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            )
        ):
            raise ValueError(
                "Director endpoint requires HTTPS or HTTP loopback without credentials"
            )
        return value

    api_host: str = "127.0.0.1"
    api_port: int = Field(default=8000, ge=1, le=65535)
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"],
        validation_alias="CORS_ALLOWED_ORIGINS",
    )
    database_url: SecretStr = SecretStr(
        "postgresql://motiondna:motiondna_local@127.0.0.1:5432/motiondna"
    )

    @field_validator("api_host")
    @classmethod
    def nonempty_host(cls, value: str) -> str:
        if not value.strip() or "://" in value or "/" in value:
            raise ValueError("API_HOST must be a hostname or IP address")
        return value

    @field_validator("allowed_origins")
    @classmethod
    def explicit_origins(cls, values: list[str]) -> list[str]:
        if not values:
            raise ValueError("CORS_ALLOWED_ORIGINS must include at least one explicit origin")
        for value in values:
            parsed = urlsplit(value)
            try:
                _ = parsed.port
            except ValueError:
                raise ValueError("CORS_ALLOWED_ORIGINS contains an invalid port") from None
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or "*" in value
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("CORS_ALLOWED_ORIGINS must contain HTTP(S) origins without paths")
        return list(dict.fromkeys(values))

    @field_validator("database_url")
    @classmethod
    def postgres_url(cls, value: SecretStr) -> SecretStr:
        parsed = urlsplit(value.get_secret_value())
        try:
            _ = parsed.port
        except ValueError:
            raise ValueError("DATABASE_URL contains an invalid port") from None
        if (
            parsed.scheme not in {"postgres", "postgresql"}
            or not parsed.hostname
            or not parsed.path
        ):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL with a host and database")
        return value
