"""Run the local account retention cleanup with the package module command."""

from motion_dna_api.config import Settings
from motion_dna_api.database import apply_migrations
from motion_dna_api.projects.repository import ProjectRepository


def main() -> None:
    settings = Settings()
    apply_migrations(settings)
    removed = ProjectRepository(settings).purge_expired()
    print(f"Purged {removed} project(s) deleted more than 30 days ago.")


if __name__ == "__main__":
    main()
