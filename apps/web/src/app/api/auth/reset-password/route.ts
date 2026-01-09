import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Generate cryptographically secure 6-digit code
function generateSecureCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

// Generate reset code
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // SECURITY: Always return success to prevent user enumeration
    // Even if user doesn't exist, return same response
    if (!user || !user.passwordHash) {
      // Still return success to prevent enumeration
      return NextResponse.json({
        success: true,
        message: "If an account exists with this email, a reset code has been sent",
      });
    }

    // Generate cryptographically secure 6-digit reset code
    const resetCode = generateSecureCode();
    const resetExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store reset code in verification fields
    await prisma.user.update({
      where: { id: user.id },
      data: {
        verificationCode: resetCode,
        verificationExpiry: resetExpiry,
      },
    });

    // Send reset email via Resend
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || "Polyx <onboarding@resend.dev>";

    if (apiKey) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: normalizedEmail,
            subject: "Reset your Polyx password",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Reset your password</h2>
                <p>Your password reset code is:</p>
                <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
                  ${resetCode}
                </div>
                <p>This code expires in 10 minutes.</p>
                <p>If you didn't request this, you can safely ignore this email.</p>
              </div>
            `,
          }),
        });
      } catch (emailErr) {
        console.error("[reset-password] Failed to send email:", emailErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: "If an account exists with this email, a reset code has been sent",
      // SECURITY: Never return reset code in response - it's sent via email
    });
  } catch (error) {
    console.error("Error generating reset code:", error);
    return NextResponse.json({ error: "Failed to generate reset code" }, { status: 500 });
  }
}

// Password complexity requirements
function validatePasswordComplexity(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }
  return null;
}

// Verify reset code and set new password
export async function PUT(request: NextRequest) {
  try {
    const { email, code, newPassword } = await request.json();

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: "Email, code, and new password are required" }, { status: 400 });
    }

    // Validate password complexity
    const passwordError = validatePasswordComplexity(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Generic error to prevent enumeration
      return NextResponse.json({ error: "Invalid reset code" }, { status: 400 });
    }

    // Verify reset code using timing-safe comparison
    const storedCode = user.verificationCode || "";
    const providedCode = String(code);

    const codeMatch = storedCode.length === providedCode.length &&
      crypto.timingSafeEqual(Buffer.from(storedCode), Buffer.from(providedCode));

    if (!codeMatch) {
      return NextResponse.json({ error: "Invalid reset code" }, { status: 400 });
    }

    if (user.verificationExpiry && new Date() > user.verificationExpiry) {
      return NextResponse.json({ error: "Reset code has expired" }, { status: 400 });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password and clear reset code
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        verificationCode: null,
        verificationExpiry: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error resetting password:", error);
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }
}
