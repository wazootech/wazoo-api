// QA round trip scenario: readiness and platform-token minting/revocation
// (wazoo-api#149). Behavior identical to the pre-split inline code.
export async function checkReadiness(context) {
  const { call, record, config } = context;
  for (const url of [`${config.API}/ready`, `${config.DATA}/ready`]) {
    const res = await call("GET", url, "none");
    record(
      `readiness ${new URL(url).host}`,
      res.status === 200,
      "full /ready body recorded",
      res,
    );
  }
}

// The user's uid is the worlds-api namespace (wazoo-api derives tenancy from
// the token, never a body field), which the credential endpoints key on.
export async function mintPlatformToken(context, email, label) {
  const { call, record, config, evidence, run } = context;
  const me = await call(
    "GET",
    `${config.API}/v1/users/me?email=${encodeURIComponent(email)}`,
    config.ADMIN,
  );
  const uid = me.json?.user?.uid;
  const res = await call("POST", `${config.API}/v1/auth/api-tokens`, config.ADMIN, {
    email,
    tokenName: `${run}-${label}`,
    scope: "users.read users.write worlds.read worlds.write usage.read",
  });
  const token =
    res.json?.token?.token ?? res.json?.token ?? res.json?.apiToken?.token;
  if (typeof token === "string") evidence.secrets.add(token);
  record(
    `mint platform token (${label})`,
    res.status === 201 && typeof token === "string",
    "non-admin user token minted",
    res,
  );
  return { token, uid };
}

export function pushTokenCleanup(context) {
  const { call, record, config, run, emailA, emailB, cleanup } = context;
  cleanup.push(async () => {
    for (const [email, label] of [
      [emailA, "a"],
      [emailB, "b"],
    ]) {
      const res = await call(
        "DELETE",
        `${config.API}/v1/auth/api-tokens/${run}-${label}?email=${encodeURIComponent(email)}`,
        config.ADMIN,
      );
      record(
        `cleanup platform token (${label})`,
        res.status < 300 || res.status === 404,
        "revoked",
        res,
      );
    }
  });
}
