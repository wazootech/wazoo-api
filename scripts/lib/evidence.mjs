// Evidence recording for the QA round trip (wazoo-api#149). Same entry shape,
// PASS/FAIL lines and exit semantics as the original inline helpers in
// scripts/qa-roundtrip.mjs, extracted so the scenario modules can share them.
import { writeFileSync } from "node:fs";
import { nowIso } from "./mode.mjs";
import { Secrets } from "./http.mjs";

export { Secrets };

export class Evidence {
  constructor(run) {
    this.run = run;
    this.startedAt = nowIso();
    this.steps = [];
    this.failed = false;
    this.secrets = new Secrets();
  }

  redact(value) {
    return this.secrets.redact(value);
  }

  record(name, pass, detail, response) {
    if (!pass) this.failed = true;
    const entry = {
      name,
      pass,
      detail: this.redact(detail),
      status: response?.status,
      body: response ? this.redact(response.text).slice(0, 400) : undefined,
    };
    this.steps.push(entry);
    console.log(
      `${pass ? "PASS" : "FAIL"}  ${name}: ${entry.detail}${response ? ` [${response.status}]` : ""}`,
    );
    return pass;
  }

  // Writes the redacted evidence JSON when a path was given and returns the
  // process exit code. Used from the script's finally block.
  finish(evidencePath) {
    const evidence = {
      startedAt: this.startedAt,
      run: this.run,
      steps: this.steps,
    };
    evidence.finishedAt = nowIso();
    evidence.result = this.failed ? "FAIL" : "PASS";
    if (evidencePath)
      writeFileSync(evidencePath, this.redact(JSON.stringify(evidence, null, 2)));
    console.log(`Round trip ${evidence.result}`);
    return this.failed ? 1 : 0;
  }
}
