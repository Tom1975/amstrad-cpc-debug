#!/usr/bin/env python3
"""
Update the version field in package.json.

Usage:
    python3 set_version.py 1.2.3
    python3 set_version.py release_1_2_3   # underscores converted automatically
"""

import json
import re
import sys
from pathlib import Path

def parse_version(raw: str) -> str:
    v = raw.strip()
    v = re.sub(r'^release_', '', v)
    v = v.replace('_', '.')
    if not re.match(r'^\d+\.\d+\.\d+$', v):
        sys.exit(f"Invalid version '{v}'. Expected x.y.z or release_x_y_z.")
    return v

def main():
    if len(sys.argv) != 2:
        sys.exit(f"Usage: {sys.argv[0]} <version>")

    version = parse_version(sys.argv[1])
    pkg = Path(__file__).parent / 'package.json'
    data = json.loads(pkg.read_text(encoding='utf-8'))
    old = data.get('version', '?')
    data['version'] = version
    pkg.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f"package.json: {old} → {version}")

if __name__ == '__main__':
    main()
