"""Compatibility entry point for the shared GTD preprocessing pipeline."""
import runpy
import sys
from pathlib import Path

folder = Path(__file__).resolve().parents[1] / "preprocess"
sys.path.insert(0, str(folder))
runpy.run_path(str(folder / "preprocess.py"), run_name="__main__")
