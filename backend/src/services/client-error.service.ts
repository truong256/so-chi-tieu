const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SAFE_DIGEST = /^[A-Za-z0-9_-]{1,128}$/;

export type ClientErrorReport = {
  name: string;
  digest?: string;
};

export function normalizeClientErrorReport(
  payload: Record<string, unknown>,
): ClientErrorReport {
  const name =
    typeof payload.name === "string" && SAFE_ERROR_NAME.test(payload.name)
      ? payload.name
      : "ClientError";
  const digest =
    typeof payload.digest === "string" && SAFE_DIGEST.test(payload.digest)
      ? payload.digest
      : undefined;

  return { name, ...(digest ? { digest } : {}) };
}
