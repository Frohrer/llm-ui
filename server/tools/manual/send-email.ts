import type { Tool } from './types';
import nodemailer from 'nodemailer';

// SMTP configuration from environment variables
const smtpConfig = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  // Add TLS options to handle SSL/TLS properly
  tls: {
    // Do not fail on invalid certs
    rejectUnauthorized: false
  }
};

// Check if SMTP is configured
const isSmtpConfigured = () => {
  return !!(smtpConfig.host && smtpConfig.auth.user && smtpConfig.auth.pass);
};

// Validate port and security settings (only if SMTP is configured)
if (isSmtpConfigured()) {
  if (smtpConfig.secure && smtpConfig.port !== 465) {
    console.warn('Warning: Using secure:true with non-standard port. Standard secure port is 465');
  }
  if (!smtpConfig.secure && smtpConfig.port !== 587 && smtpConfig.port !== 25) {
    console.warn('Warning: Using secure:false with non-standard port. Standard non-secure ports are 587 or 25');
  }
}

export const sendEmailTool: Tool = {
  name: 'send_email',
  description: 'Sends an email using SMTP',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address'
      },
      subject: {
        type: 'string',
        description: 'Email subject'
      },
      text: {
        type: 'string',
        description: 'Plain text email body'
      },
      html: {
        type: 'string',
        description: 'HTML email body (optional)'
      }
    },
    required: ['to', 'subject', 'text']
  },
  execute: async (params: {
    to: string,
    subject: string,
    text: string,
    html?: string
  }) => {
    // Check if SMTP is configured
    if (!isSmtpConfigured()) {
      return {
        success: false,
        error: 'SMTP not configured',
        details: 'SMTP environment variables (SMTP_HOST, SMTP_USER, SMTP_PASS) are not set. Email functionality is disabled.'
      };
    }

    try {
      // Create transporter using environment variables
      const transporter = nodemailer.createTransport(smtpConfig);

      // Send mail
      const info = await transporter.sendMail({
        from: smtpConfig.auth.user,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html
      });

      return {
        success: true,
        messageId: info.messageId,
        response: info.response
      };
    } catch (error) {
      console.error('Error sending email:', error);
      return {
        success: false,
        error: 'Error sending email',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}; 