import { authenticator } from "otplib";

export interface TOTPSetup {
  secret: string;
  otpauthUrl: string;
}

/**
 * Generate a new TOTP secret for 2FA setup
 */
export function generateTOTPSecret(email: string): TOTPSetup {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(email, "Polyx", secret);

  return {
    secret,
    otpauthUrl,
  };
}

/**
 * Verify a TOTP token against a secret
 */
export function verifyTOTPToken(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

/**
 * Generate a TOTP token from a secret (for testing)
 */
export function generateTOTPToken(secret: string): string {
  return authenticator.generate(secret);
}
