import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

interface ConfirmationTokenPayload {
  v: number;
  email: string;
  exp: number;
  jti: string;
}

interface ConfirmationEnvironment {
  APP_BASE_URL?: string;
  SUBSCRIPTION_CONFIRMATION_SECRET?: string;
}

export class ConfirmationTokenError extends Error {
  constructor(
    readonly code: "expired" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "ConfirmationTokenError";
  }
}

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`缺少环境变量 ${name}`);
  return normalized;
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createConfirmationToken(
  email: string,
  secret: string,
  now = new Date(),
  ttlSeconds = DEFAULT_TTL_SECONDS,
) {
  const payload: ConfirmationTokenPayload = {
    v: TOKEN_VERSION,
    email: email.trim().toLowerCase(),
    exp: Math.floor(now.getTime() / 1000) + ttlSeconds,
    jti: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export function verifyConfirmationToken(
  token: string,
  secret: string,
  now = new Date(),
) {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) {
    throw new ConfirmationTokenError("invalid", "确认链接格式无效");
  }

  const expected = Buffer.from(signature(encodedPayload, secret));
  const actual = Buffer.from(encodedSignature);
  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new ConfirmationTokenError("invalid", "确认链接签名无效");
  }

  let payload: ConfirmationTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as ConfirmationTokenPayload;
  } catch {
    throw new ConfirmationTokenError("invalid", "确认链接内容无效");
  }

  if (
    payload.v !== TOKEN_VERSION ||
    typeof payload.email !== "string" ||
    !payload.email ||
    typeof payload.exp !== "number" ||
    typeof payload.jti !== "string" ||
    !payload.jti
  ) {
    throw new ConfirmationTokenError("invalid", "确认链接内容无效");
  }

  if (payload.exp <= Math.floor(now.getTime() / 1000)) {
    throw new ConfirmationTokenError("expired", "确认链接已过期");
  }

  return {
    email: payload.email.trim().toLowerCase(),
    expiresAt: new Date(payload.exp * 1000),
  };
}

export function createConfirmationLinkFactory(
  environment: ConfirmationEnvironment = process.env,
) {
  const baseUrl = required(environment.APP_BASE_URL, "APP_BASE_URL").replace(
    /\/+$/,
    "",
  );
  const secret = required(
    environment.SUBSCRIPTION_CONFIRMATION_SECRET,
    "SUBSCRIPTION_CONFIRMATION_SECRET",
  );

  return (email: string) => {
    const token = createConfirmationToken(email, secret);
    return `${baseUrl}/?confirmation_token=${encodeURIComponent(token)}`;
  };
}

export function verifyEnvironmentConfirmationToken(
  token: string,
  environment: ConfirmationEnvironment = process.env,
) {
  return verifyConfirmationToken(
    token,
    required(
      environment.SUBSCRIPTION_CONFIRMATION_SECRET,
      "SUBSCRIPTION_CONFIRMATION_SECRET",
    ),
  );
}
