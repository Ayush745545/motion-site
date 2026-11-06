"""Static source repository analysis. Repository contents are never executed."""

from .models import SourceDNA
from .service import analyze_files, analyze_zip

__all__ = ["SourceDNA", "analyze_files", "analyze_zip"]
