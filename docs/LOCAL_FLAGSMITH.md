# Local Flagsmith runtime and reproducibility

## What was actually verified

On 26 November 2026, a real, unmodified Flagsmith backend was run locally with a
real PostgreSQL database. Its migrations completed successfully, the liveness
endpoint returned HTTP 200, and API bootstrap created a dedicated demo
organisation, project and environment. The PostgreSQL warehouse connection
returned `status: connected`.

The runtime uses newly created demonstration data. Its credentials and database
are local development state and are not part of this repository. Experiment
execution and recorded results are documented separately in the entry's
verification evidence; a healthy warehouse alone does not establish an A/B-test
result.

## Verified versions

| Component | Exact version/source |
| --- | --- |
| Flagsmith source | Official `Flagsmith/flagsmith` repository, commit `181a4f6c335055bdca6b6b80e70692f36037a07f` |
| Backend declared version | `flagsmith-api` 2.68.0 in `api/pyproject.toml` |
| Python used | CPython 3.12.14, Linux x86-64 |
| PostgreSQL binary | PostgreSQL 16.16 |
| Binary distribution | npm package `@embedded-postgres/linux-x64@16.16.0-beta.19` |
| Python dependencies | Exact 164-package snapshot at the end of this document |
| Task execution | `TASK_RUN_METHOD=SEPARATE_THREAD` |
| Database listener | Loopback only, port 55432, SCRAM password authentication |
| API listener | Loopback only, port 8000, Gunicorn with one worker and four threads |

The PostgreSQL package is a third-party binary distribution published through
npm; it is not a Flagsmith package. The package version includes `beta`, while
its bundled executable reports PostgreSQL 16.16. Its npm tarball integrity was
verified before extraction:

```text
https://registry.npmjs.org/@embedded-postgres/linux-x64/-/linux-x64-16.16.0-beta.19.tgz
sha512-99xFwRl+/dokUUBDjUC42CKUrWU+o9iJlbk4U7/S0RJ3fN3I2g3Dmcj1SBgKllrgvFXPRboqMB+SsApm6/W9EQ==
```

The package's own `scripts/hydrate-symlinks.js` must run after manual extraction.
It restores relative library symlinks declared in `native/pg-symlinks.json`.
Without it, the binaries cannot locate their bundled ICU libraries.

## Recommended setup on a normal development machine

The official Flagsmith local-setup guide supplies Docker Compose and API
bootstrap instructions:

- [Run locally with a coding agent](https://docs.flagsmith.com/getting-started/run-locally-with-a-coding-agent)
- [Self-hosted experimentation](https://docs.flagsmith.com/experimentation/self-hosting)
- [Create and instrument an experiment](https://docs.flagsmith.com/experimentation/set-up-with-a-coding-agent)

For a convenient local instance, download the official Compose configuration
from the source revision used here:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/Flagsmith/flagsmith/181a4f6c335055bdca6b6b80e70692f36037a07f/docker-compose.yml \
  -o flagsmith-compose.yml
docker compose -f flagsmith-compose.yml up -d
```

This convenience configuration references the `latest` Flagsmith image, so it
is **not an exact reproduction of the source-based run above**. Pin a verified
image digest for an immutable Docker run, or use the pinned source and dependency
snapshot below. The published Compose configuration includes a dedicated task
processor because it sets `TASK_RUN_METHOD=TASK_PROCESSOR`. Keep that service
running when using the unchanged official Compose file. Its example secrets
are intended for local evaluation; use an isolated local instance.

The local runtime verified here instead used the official backend directly
because Docker was unavailable. It did not change Flagsmith application source.

## Reproducing the native runtime

Check out the exact official revision in a separate directory:

```bash
git clone https://github.com/Flagsmith/flagsmith.git flagsmith-local
git -C flagsmith-local checkout --detach 181a4f6c335055bdca6b6b80e70692f36037a07f
cd flagsmith-local
python3.12 -m venv .venv
```

Save the dependency snapshot at the end of this document as
`requirements-local.lock`, then install it into this dedicated environment:

```bash
uv pip install --python .venv/bin/python -r requirements-local.lock
```

The source permits Python `>=3.11,<3.14`. Its project-level uv workflow requires
uv `>=0.13.7` and includes an optional private package index. The verified run
used the public base dependencies through `uv pip install`, did not install the
private extra, and did not invoke `uv lock` or access that private index.
`django-debug-toolbar` and `django-extensions` are included in the snapshot
because they were installed during setup; production settings do not require
the local debugging configuration.

Install the pinned PostgreSQL distribution in an isolated directory, allowing
only its inspected symlink hydration step:

```bash
npm install --prefix .local-postgres --ignore-scripts --save-exact \
  @embedded-postgres/linux-x64@16.16.0-beta.19
node .local-postgres/node_modules/@embedded-postgres/linux-x64/scripts/hydrate-symlinks.js
```

The binaries are then under
`.local-postgres/node_modules/@embedded-postgres/linux-x64/native/bin/`.
Initialise a fresh UTF-8 cluster with `initdb`, a generated password file with
permissions 0600, user `studio_flagsmith`, and
`--auth=scram-sha-256 --no-locale -E UTF8`. Start it with `pg_ctl`, restricted to
`127.0.0.1:55432`, and create a UTF-8 database named `studio_flagsmith`.
The verified environment did not permit Unix sockets; PostgreSQL's ordinary
loopback listener was used with `-k '' -h 127.0.0.1 -p 55432`.

Provide the following settings privately to the backend process. Placeholder
values below must be replaced with newly generated local values:

```dotenv
DATABASE_URL=postgresql://studio_flagsmith:GENERATED_PASSWORD@127.0.0.1:55432/studio_flagsmith
DJANGO_SECRET_KEY=GENERATED_SECRET
DJANGO_SETTINGS_MODULE=app.settings.production
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
ENVIRONMENT=production
EXPERIMENTATION_ENABLED=true
DISABLE_FLAGSMITH_UI=true
DISABLE_ANALYTICS_FEATURES=true
EMAIL_BACKEND=django.core.mail.backends.locmem.EmailBackend
TASK_RUN_METHOD=SEPARATE_THREAD
```

From `api/`, using the dedicated environment with those settings loaded, run:

```bash
../.venv/bin/python manage.py migrate --noinput
../.venv/bin/gunicorn --bind 127.0.0.1:8000 --workers 1 --threads 4 \
  --timeout 120 app.wsgi:application
```

Bootstrap only a fresh instance using the official local guide: create the
initial admin, organisation, project, development environment and organisation
API key. No external email delivery is configured. Connect the environment's
warehouse with this authenticated management request:

```text
POST /api/v1/environments/<environment-key>/warehouse-connections/
{"warehouse_type":"postgres","config":{"source":"flagsmith_database"}}
```

The guide distinguishes the initial `Authorization: Token ...` user token from
the later `Authorization: Api-Key ...` organisation API key. Keep both on the
server. The warehouse response must report `connected` before running the demo.

## Background work and event delivery

In the verified source, SDK ingestion writes accepted events directly to the
PostgreSQL table. Result refresh calls `compute_experiment_results.delay()`.
With `TASK_RUN_METHOD=SEPARATE_THREAD`, the official task decorator runs that
function in an API-process thread. **No separate task-processor process is
required for this mode.** Keep the API alive until the result response has a
populated `results.as_of` and `results.payload`.

With `TASK_RUN_METHOD=TASK_PROCESSOR`, jobs are queued and the separate processor
is required; merely starting the API is insufficient. Do not mix the two setup
modes accidentally.

The primary supporting source files in the pinned revision are:

- `api/app/settings/common.py`: self-hosted task mode and experimentation setting.
- `api/experimentation/views.py`: ingestion, lifecycle and results endpoints.
- `api/experimentation/tasks.py`: experiment result computation.
- `api/experimentation/services.py`: SDK event persistence.
- `task_processor/decorators.py` in the installed `flagsmith-common` distribution:
  dispatch behavior for separate-thread and queued task modes.

Result refresh is limited to one request per experiment every five minutes.
Send one refresh, then poll the read endpoint; do not repeatedly request refresh.
SDK clients must flush events before polling results or exiting.

## Connect Studio Experiment Pilot

Run the Pilot with a dedicated local development environment:

```dotenv
PILOT_MODE=live
FLAGSMITH_API_URL=http://127.0.0.1:8000
FLAGSMITH_EVENTS_URL=http://127.0.0.1:8000/api/
FLAGSMITH_API_KEY=PRIVATE_ORGANISATION_API_KEY
FLAGSMITH_ENVIRONMENT_KEY=LOCAL_ENVIRONMENT_SDK_KEY
FLAGSMITH_PROJECT_ID=LOCAL_PROJECT_ID
```

For the Node SDK, `apiUrl` is the API base followed by `/api/v1/`.
`eventsApiUrl` is exactly `http://127.0.0.1:8000/api/`; the SDK appends `v1/events`.
The SDK package used by the Pilot is `@flagsmith/nodejs`, with experimentation
support beginning at 9.1.0. Use the Pilot lockfile for its resolved version.

Some managed execution environments isolate each command's network namespace.
In that case, launch PostgreSQL, Flagsmith, the Pilot and its local verification
client in the **same parent process invocation**. Start the services, wait for
health, run the application or demo command, then stop only the services created
by that invocation. Do not remove an existing server or reuse its data.

The private hosted Pilot can use rehearsal mode independently of this native
runtime. Hosting the Pilot's frontend does not also host PostgreSQL or the
Flagsmith backend. Synthetic traffic passed through a real Flagsmith engine
must still be labelled synthetic.

## Exact Python package snapshot

This is the resolved environment used for the verified native runtime, rather
than a claim that the repository's broad dependency ranges always resolve to
these versions. Save the following block verbatim as `requirements-local.lock`
when reproducing that environment. Reproduction additionally requires compatible
Linux x86-64 wheels/system libraries and the PostgreSQL distribution listed above.

```text
Django==5.2.19
Jinja2==3.1.6
MarkupSafe==3.0.4
PyGithub==2.8.1
PyJWT==2.15.1
PyNaCl==1.6.2
PyOTP==2.12.1
PyYAML==6.0.4
annotated-types==0.8.0
anyio==4.14.2
appdirs==1.4.4
asgiref==3.8.1
attrs==26.1.0
backoff==2.2.1
backports.zstd==1.8.0
boto3==1.35.99
botocore==1.35.99
certifi==2026.11.20
cffi==2.1.1
chargebee==3.32.0
charset-normalizer==3.5.3
clickhouse-connect==1.13.0
clickhouse-driver==0.2.11
coreapi==2.3.3
coreschema==0.0.4
cryptography==50.0.2
defusedxml==0.7.1
deprecation==2.1.0
dj-database-url==3.0.1
django-admin-sso==5.2.0
django-axes==8.3.1
django-clickhouse-backend==2.0
django-cockroachdb==4.2
django-cors-headers==3.5.0
django-debug-toolbar==8.0.0
django-environ==0.4.5
django-extensions==4.1
django-filter==2.4.0
django-health-check==3.18.3
django-lifecycle==1.2.4
django-oauth-toolkit==3.4.1
django-ordered-model==3.4.3
django-redis==5.4.0
django-ses==3.5.2
django-simple-history==2.12.0
django-softdelete==0.11.5
django-storages==1.10.1
django-stubs==5.2.9
django-stubs-ext==6.1.2
djangorestframework==3.18.3
djangorestframework-api-key==2.2.0
djangorestframework-dataclasses==1.4.0
djangorestframework-recursive==0.1.2
djangorestframework_simplejwt==5.5.1
djoser==2.3.5
drf-nested-routers==0.92.5
drf-spectacular==0.28.0
drf-writable-nested==0.6.4
environs==14.6.0
flagsmith==6.7.0
flagsmith-common==3.17.0
flagsmith-flag-engine==11.1.2
flagsmith-sql-flag-engine==0.2.1
google-api-core==2.44.0
google-api-python-client==1.12.11
google-auth==2.63.1
google-auth-httplib2==0.4.4
google-re2==1.1.20251105
googleapis-common-protos==1.76.0
grpcio==1.85.4
gunicorn==23.0.0
h11==0.16.0
httpcore==1.0.9
httplib2==0.32.1
httpx==0.28.1
hubspot-api-client==12.0.0
idna==3.20
inflection==0.5.1
influxdb-client==1.50.0
iregexp-check==0.1.4
itypes==1.2.0
jmespath==1.1.0
jsonpath-rfc9535==0.2.0
jsonschema==4.26.0
jsonschema-specifications==2025.9.1
jwcrypto==1.6.2
lz4==4.4.5
marshmallow==4.4.0
monotonic==1.6
oauth2client==4.1.3
oauthlib==4.0.1
openfeature-provider-flagsmith==1.0.0
openfeature-sdk==0.9.0
opentelemetry-api==1.45.2
opentelemetry-exporter-http-transport==0.66b2
opentelemetry-exporter-otlp-common==0.66b2
opentelemetry-exporter-otlp-proto-common==1.45.2
opentelemetry-exporter-otlp-proto-grpc==1.45.2
opentelemetry-exporter-otlp-proto-http==1.45.2
opentelemetry-instrumentation==0.66b2
opentelemetry-instrumentation-dbapi==0.66b2
opentelemetry-instrumentation-django==0.66b2
opentelemetry-instrumentation-psycopg2==0.66b2
opentelemetry-instrumentation-redis==0.66b2
opentelemetry-instrumentation-wsgi==0.66b2
opentelemetry-proto==1.45.2
opentelemetry-sdk==1.45.2
opentelemetry-semantic-conventions==0.66b2
opentelemetry-util-http==0.66b2
packaging==26.4
prometheus_client==0.21.1
proto-plus==1.29.0
protobuf==7.36.2
psycopg2-binary==2.9.13
pyasn1==0.6.5
pyasn1_modules==0.4.2
pycparser==3.12
pydantic==2.12.5
pydantic-collections==0.6.0
pydantic_core==2.41.5
pymemcache==4.0.0
pyngo==2.4.1
pyparsing==3.3.3
python-dateutil==2.9.0.post0
python-dotenv==1.2.4
python-gnupg==0.5.7
python-http-client==3.3.7
python3-openid==3.2.0
pytz==2026.6
reactivex==6.1.1
redis==5.3.1
referencing==0.37.0
regex==2026.11.25
requests==2.33.1
requests-futures==1.1.0
requests-oauthlib==2.0.0
rpds-py==2026.9.1
rsa==4.9.1
rudder-sdk-python==2.2.1
s3transfer==0.10.4
segment-analytics-python==2.2.3
semver==3.1.2
sendgrid==3.6.5
sendgrid-django==4.2.0
sentry-sdk==2.77.0
shortuuid==1.0.13
simplejson==3.19.3
six==1.16.0
slack-sdk==3.9.1
smart_open==7.7.1
social-auth-app-django==5.9.0
social-auth-core==4.9.1
sqlparse==0.6.1
sseclient-py==1.9.0
structlog==24.4.0
types-PyYAML==6.0.12.20261122
typing-inspection==0.4.5
typing_extensions==4.15.0
tzdata==2024.2
tzlocal==5.4.5
uritemplate==3.0.1
urllib3==2.8.0
whitenoise==6.0.0
wrapt==2.5.2
```
