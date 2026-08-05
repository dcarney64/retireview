// Gmail setup: enable 2-Step Verification on Google account,
// then create an App Password at myaccount.google.com/apppasswords
// Use the App Password as SMTP_PASS (not your Gmail password)

import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: Number(process.env.SMTP_PORT) || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }
    return transporter;
}

async function send(to, subject, body) {
    await getTransporter().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        ...body,
    });
}

export async function sendOTPEmail(toEmail, code, ipAddress) {
    if (process.env.DEV_MODE_LOG_OTP === 'true') {
        console.log(`[2FA] DEV_MODE_LOG_OTP — OTP for ${toEmail} from ${ipAddress}: ${code}`);
        return;
    }

    const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #0f172a;">ProjectName Login Verification</h2>
      <p>Your verification code is:</p>
      <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #3b82f6; padding: 16px 0;">${code}</div>
      <p>This code expires in 10 minutes.</p>
      <p style="color: #64748b; font-size: 14px;">
        Login attempted from IP: ${ipAddress}<br>
        If this wasn't you, your password may be compromised.
      </p>
    </div>
    `;
    await send(toEmail, 'ProjectName Login Verification Code', { html });
}

export async function sendSecurityAlert(toEmail, alertType, details) {
    if (process.env.DEV_MODE_LOG_OTP === 'true') {
        console.log(`[security] DEV_MODE_LOG_OTP — ${alertType} alert for ${toEmail}:`, JSON.stringify(details));
        return;
    }

    const subjects = {
        new_ip: 'New login location detected — ProjectName',
        impossible_travel: 'Unusual login detected — ProjectName',
        account_blocked: 'Your account has unusual activity — ProjectName',
    };

    const messages = {
        new_ip: `A login was detected from a new location:
IP: ${details.ip}
Location: ${[details.city, details.country].filter(Boolean).join(', ') || 'unknown'}
Time: ${new Date().toLocaleString()}

If this was you, no action needed.
If this wasn't you, change your password immediately.`,
        impossible_travel: `We detected logins from two locations that are impossibly far apart within a short time:
Previous: ${details.prevCity}
New: ${[details.newCity, details.newCountry].filter(Boolean).join(', ') || 'unknown'} (${details.distance}km away)
Time between logins: ${details.timeDiffHours} hours

If this wasn't you, change your password immediately.`,
        account_blocked: `Repeated failed login attempts were detected on your account:
IP: ${details.ip}
The IP has been temporarily blocked.

If this wasn't you, no action is needed — your password was not compromised.`,
    };

    await send(toEmail, subjects[alertType], { text: messages[alertType] });
}

export async function sendNewIPAlert(toEmail, ipAddress) {
    if (process.env.DEV_MODE_LOG_OTP === 'true') {
        console.log(`[2FA] DEV_MODE_LOG_OTP — new IP alert for ${toEmail}: ${ipAddress}`);
        return;
    }

    const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #0f172a;">New Login Location</h2>
      <p>A new login was verified from IP: <strong>${ipAddress}</strong></p>
      <p>This device has been added to your trusted devices.</p>
      <p style="color: #64748b; font-size: 14px;">
        If this wasn't you, log in immediately and change your password.
      </p>
    </div>
    `;
    await send(toEmail, 'New login location detected — ProjectName', { html });
}
