# Session and metadata handling

How the SAP Business One Service Layer node handles Service Layer sessions and metadata. For an overview, see the [README](../README.md).

## Session handling

The node manages Service Layer sessions itself. It signs in once per credential, keeps the session in memory, and reuses it for later requests.

- The session is created with `POST /Login` and identified by the `B1SESSION` cookie. `ROUTEID` is kept when the Service Layer returns one, and updated if a later response re-routes the session.
- The server-provided `SessionTimeout` is treated as an idle timeout, measured from the last successful request. No lifetime is assumed when the Service Layer reports none; such a session is only discarded once the Service Layer rejects it.
- Concurrent requests using the same credential share a single login instead of opening one licensed session each.
- A session the Service Layer reports as invalid is discarded, and the failed request is retried once after a new login.
- Editing the credential replaces its cached session rather than leaving a stale one behind.
- Sessions are held per n8n process. In queue mode each worker keeps its own session, so one credential can hold up to one licensed session per worker. Sessions are not kept across restarts.
- The session never appears as a node parameter, a credential field, or node output, and session cookies are kept out of logs and error messages.

Sessions are not logged out yet; they end when they time out.

Passwords, session cookies, and other secrets must not be included in workflow parameters, logs, issues, screenshots, or example data.

## Metadata handling

The node reads the connected instance's Service Layer metadata (`/$metadata`) over the same session, parses it, and keeps the result in memory. It fills the lists in the editor and tells the node how to build each request.

- Metadata is cached per Service Layer instance and company database, whichever SAP user connects — different credentials against the same Base URL and company database share one cached copy.
- The editor's lists answer from the cache at once. Once the last check is older than two minutes, a list also checks in the background whether the metadata or the SAP labels changed. After you add a field or a table in SAP Business One (UDF, UDT, UDO), the first **Refresh List** starts that check and still shows the old state; a refresh a moment later shows the new field. While the editor is not used, the node sends no metadata requests. A failing check keeps the cached state and shows no error.
- Running a workflow never waits for or starts such a check. It uses the cached metadata while it is younger than one hour, otherwise it loads it again first. Concurrent metadata requests are collapsed into a single fetch.
- Metadata is cached per n8n process, like sessions: in queue mode, each worker fetches and caches its own copy.
- Only the Service Layer v2 API's OData V4 metadata is supported. Older v1-only instances expose a different, incompatible format — actions and functions don't exist in it at all — and are rejected with a clear error rather than silently returning an entity list with no operations.
- Parsing failures are reported without exposing the raw metadata document, which can be large and contains customer-specific schema details.
