"""The Build Process: turns Template/ + <CODE>/ + VisiLean data into dist/<CODE>/index.html and data/<CODE>/*.csv."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(ROOT, "Template")
DIST_DIR = os.path.join(ROOT, "dist")
DATA_DIR = os.path.join(ROOT, "data")
CACHE_DIR = os.path.join(ROOT, ".cache")
SAMPLE_DIR = os.path.join(ROOT, "sample")
TOKENS_FILE = os.path.join(ROOT, "tokens.json")
DEFAULTS_FILE = os.path.join(ROOT, "build", "project_defaults.json")
