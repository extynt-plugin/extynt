/** The native-spike usage text. */
export const USAGE = `native-spike: measure and verify the extynt native After Effects plugin.

usage:
  node tools/native-spike/spike.ts [bench] [options]
  node tools/native-spike/spike.ts compare [--probe FILE | --sidecar URL] [options]
  node tools/native-spike/spike.ts dump OP [JSON-PARAMS] [options]

commands:
  bench     (default) time ping_direct, ping, revision, read_project, read_comp, read_paths and
            hash_project; optionally with an AE CPU sample (--cpu-sample).
  compare   read the project natively (read_project full, hashes off) and compare it with an
            ExtendScript probe snapshot. Exit 0 on PASS, 1 on FAIL.
  dump      print the raw response of one op, pretty-printed (for debugging). JSON-PARAMS is a
            JSON object of op parameters, e.g. '{"compId":"229","detail":"full"}'.

connection options:
  --discovery FILE   discovery file (default: ~/Library/Application Support/extynt/native.json
                     on macOS, ~/.config/extynt/native.json elsewhere)
  --timeout-ms N     per-request timeout (default 30000)
  --no-pid-check     do not reject a discovery file whose pid is not running
  --json             machine-readable result on stdout; the human report goes to stderr
  --out FILE         also write the JSON result to FILE (bench and compare)
  -h, --help         show this text

bench options:
  --runs N           measured requests per op (default 20); the first is reported as cold
  --comp-id ID       composition to read (default: the one with the most layers)
  --comp-name NAME   composition by name
  --layer-name NAME  layer for read_paths (default: its first layer)
  --layer-id ID      layer by id (instead of --layer-name)
  --path PATH        property path for read_paths (default "ADBE Transform Group/ADBE Position")
  --cpu-sample       sample AE's CPU with ps, once per second, with no requests sent; needs the pid in
                     the discovery file. Alone it runs only the CPU phase; with an explicit "bench" it
                     runs after the bench
  --cpu-seconds N    samples (default 10, 1 to 3000)

compare options:
  --probe FILE       probe snapshot JSON: the raw aeEyesOpenProbe envelope (also as written by
                     tools/native-spike/probe-dump.jsx, with a UTF-8 BOM, or JSON-encoded as a
                     string), the sidecar's GET /v1/snapshots/latest response {ok,snapshot}, or the
                     bare result; an ok:false envelope is reported with the probe's error code
  --sidecar URL      fetch /v1/snapshots/latest instead (default http://127.0.0.1:3210,
                     env AE_BRIDGE_PORT, else the port in the sidecar's session.json)
  --sidecar-token T  sidecar bearer token (default: env AE_BRIDGE_TOKEN, else session.json)
  --session-file F   the sidecar's session.json (default: next to native.json)
  --max-diffs N      examples shown per group (default 5)
  --max-properties N pass maxPropertiesPerLayer to read_project (the panel uses 512)
  --max-depth N      pass maxPropertyDepth to read_project (the panel uses 8)
  --debug-flags      ask read_project for each property's raw dynFlags and add a section grouping
                     probe.enabled by dynFlags (dynFlags itself is never compared)
  --details          also call host_call aeReadPropertyDetails for the layers with a text document or keyed
                     property and compare those text documents and key digests with the probe's (the plugin
                     reports them as unsupported or not at all)

property.hidden and property.canSetValue differences are listed under "known probe defect:
isHidden unavailable on this AE" and do not count toward PASS or FAIL.

exit codes: 0 ok / PASS, 1 FAIL or the plugin reported an error, 2 connection or usage error.
`;
