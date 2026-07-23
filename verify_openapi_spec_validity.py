#!/usr/bin/env python3
"""
verify_openapi_spec_validity.py — Validate openapi/*.yaml against the OpenAPI 3.x spec.

DIFFERENT AXIS from verify_types_openapi_sync.py:
- THAT verifier: are lib/types/*.ts files consistent with openapi/*.yaml schemas?
- THIS verifier:  are openapi/*.yaml files themselves well-formed OpenAPI 3.0.4
                  documents (independent of any TS code)?

Catches:
- Unknown root-level keys (e.g. responses: at root)
- components.responses set to null instead of an object
- Schemas using keywords not in OpenAPI 3.0.4 (e.g. JSON Schema draft-06 `const`)
- Malformed paths / parameter objects

Run:
    python3 verify_openapi_spec_validity.py
Exit:
    0 = all pass
    1 = at least one file failed OpenAPI 3.x validation
"""
import sys
from pathlib import Path

import yaml
from openapi_spec_validator import validate
from openapi_spec_validator.readers import read_from_filename

WEBAPP_ROOT = Path(__file__).resolve().parent
OPENAPI_DIR = WEBAPP_ROOT / "openapi"


def main() -> int:
    yaml_files = sorted(p for p in OPENAPI_DIR.glob("*.yaml"))
    if not yaml_files:
        print(f"FAIL: no openapi/*.yaml files found under {OPENAPI_DIR}")
        return 1

    print(f"Verifying {len(yaml_files)} OpenAPI spec file(s) "
          f"in {OPENAPI_DIR}/ ...\n")

    failures: list[tuple[str, str]] = []

    for f in yaml_files:
        try:
            spec_dict, _ = read_from_filename(str(f))
            validate(spec_dict)
        except Exception as e:
            failures.append((f.name, f"{type(e).__name__}: {e}"))
            print(f"  FAIL  {f.name}")
            # Print first 5 lines of the error for debuggability
            err_lines = str(e).splitlines()
            for line in err_lines[:5]:
                print(f"        {line}")
            print()
            continue

        # Success — emit a one-liner summary
        openapi_version = spec_dict.get("openapi", "?")
        n_paths = len(spec_dict.get("paths", {}))
        n_schemas = len(spec_dict.get("components", {}).get("schemas", {}))
        n_responses = len(spec_dict.get("components", {}).get("responses", {}))
        n_params = len(spec_dict.get("components", {}).get("parameters", {}))
        print(f"  PASS  {f.name}  (openapi={openapi_version}, "
              f"paths={n_paths}, schemas={n_schemas}, "
              f"responses={n_responses}, parameters={n_params})")

    print()
    if failures:
        print(f"{len(failures)}/{len(yaml_files)} files FAILED OpenAPI 3.x "
              f"validation.")
        return 1

    print(f"{len(yaml_files)}/{len(yaml_files)} files PASS OpenAPI 3.x "
          f"validation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())