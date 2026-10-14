# Third-party dependencies

The root MIT license covers this project's implementation; it does not replace
the licenses of installed dependencies. Dependencies are installed separately,
not bundled into this source repository. Preserve their distributed notices.

| Dependency | Version | License |
| --- | --- | --- |
| pypdf | 6.10.0 | BSD-3-Clause |
| openpyxl | 3.1.5 | MIT |
| Pillow | 12.3.0 | MIT-CMU |
| ReportLab | 4.4.9 | BSD, as stated in its packaged license.txt |

The container uses the official Node.js 24 Debian Bookworm slim image, Python
and Poppler. Those runtimes, system packages and their transitive dependencies
retain their own licenses and notices. This table describes the four pinned
Python application dependencies, not an exhaustive container software bill.

Project interface and brain graphic include preexisting design components.
Their reuse and the pre-event base are disclosed in PROVENANCE.json.
