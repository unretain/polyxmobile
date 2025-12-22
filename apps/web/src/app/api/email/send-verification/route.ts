import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

// Lazy initialization to avoid build-time errors when env var is not set
function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }
  return new Resend(apiKey);
}

export async function POST(request: NextRequest) {
  try {
    const { email, code, type = "verification" } = await request.json();

    console.log(`[send-verification] Request received - email: ${email}, type: ${type}`);

    if (!email || !code) {
      console.log(`[send-verification] Missing email or code`);
      return NextResponse.json(
        { error: "Email and code are required" },
        { status: 400 }
      );
    }

    // Determine subject and content based on type
    let subject: string;
    let title: string;
    let description: string;

    switch (type) {
      case "reset":
        subject = "Reset your Polyx password";
        title = "Reset your password";
        description = "Enter this code to reset your password and regain access to your account.";
        break;
      case "login":
        subject = "Your Polyx login code";
        title = "Your login code";
        description = "Enter this code to sign in to your Polyx account.";
        break;
      case "verification":
      default:
        subject = "Verify your Polyx account";
        title = "Verify your email";
        description = "Enter this code to verify your email address and complete your account setup.";
        break;
    }

    const resend = getResend();
    const fromEmail = process.env.RESEND_FROM_EMAIL || "Polyx <onboarding@resend.dev>";
    console.log(`[send-verification] Sending email from: ${fromEmail} to: ${email}`);
    console.log(`[send-verification] RESEND_API_KEY exists: ${!!process.env.RESEND_API_KEY}`);
    console.log(`[send-verification] RESEND_FROM_EMAIL: ${process.env.RESEND_FROM_EMAIL}`);

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${subject}</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0a;">
              <tr>
                <td align="center" style="padding: 40px 20px;">
                  <table role="presentation" width="100%" style="max-width: 480px; background-color: #111111; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
                    <!-- Header / Logo -->
                    <tr>
                      <td align="center" style="padding: 48px 40px 32px;">
                        <div style="font-size: 32px; font-weight: bold; color: white;">
                          [<span style="color: white;">poly</span><span style="color: #FF6B4A;">x</span>]
                        </div>
                      </td>
                    </tr>

                    <!-- Title -->
                    <tr>
                      <td align="center" style="padding: 0 40px;">
                        <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: white;">
                          ${title}
                        </h1>
                      </td>
                    </tr>

                    <!-- Description -->
                    <tr>
                      <td align="center" style="padding: 16px 40px 24px;">
                        <p style="margin: 0; font-size: 16px; color: rgba(255,255,255,0.6); line-height: 1.5;">
                          ${description}
                        </p>
                      </td>
                    </tr>

                    <!-- Code Box -->
                    <tr>
                      <td align="center" style="padding: 0 40px 32px;">
                        <div style="background: rgba(255,107,74,0.1); border: 2px solid rgba(255,107,74,0.3); border-radius: 12px; padding: 24px 32px;">
                          <span style="font-family: 'SF Mono', Monaco, 'Courier New', monospace; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #FF6B4A;">
                            ${code}
                          </span>
                        </div>
                      </td>
                    </tr>

                    <!-- Expiry Notice -->
                    <tr>
                      <td align="center" style="padding: 0 40px 32px;">
                        <p style="margin: 0; font-size: 14px; color: rgba(255,255,255,0.4);">
                          This code expires in <strong style="color: rgba(255,255,255,0.6);">10 minutes</strong>
                        </p>
                      </td>
                    </tr>

                    <!-- Divider -->
                    <tr>
                      <td style="padding: 0 40px;">
                        <div style="height: 1px; background: rgba(255,255,255,0.1);"></div>
                      </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                      <td align="center" style="padding: 24px 40px 40px;">
                        <p style="margin: 0; font-size: 13px; color: rgba(255,255,255,0.4); line-height: 1.5;">
                          If you didn't request this code, you can safely ignore this email.
                        </p>
                        <p style="margin: 16px 0 0; font-size: 13px; color: rgba(255,255,255,0.3);">
                          © ${new Date().getFullYear()} Polyx. All rights reserved.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("[send-verification] Resend error:", error);
      console.error("[send-verification] Error name:", error.name);
      console.error("[send-verification] Error message:", error.message);
      return NextResponse.json(
        { error: "Failed to send email", details: error.message },
        { status: 500 }
      );
    }

    console.log(`[send-verification] Email sent successfully! ID: ${data?.id}`);
    return NextResponse.json({ success: true, messageId: data?.id });
  } catch (error) {
    console.error("[send-verification] Email API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
