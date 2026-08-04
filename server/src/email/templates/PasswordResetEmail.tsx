import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout, bodyTextStyle, buttonStyle, headingStyle } from './Layout.js';

interface PasswordResetEmailProps {
  resetUrl: string;
}

export const PasswordResetEmail: React.FC<PasswordResetEmailProps> = ({ resetUrl }) => (
  <Layout previewText="Reset your Cohold password">
    <Text style={headingStyle}>Reset your password</Text>
    <Text style={bodyTextStyle}>
      We received a request to reset the password for your Cohold account. Click the
      button below to choose a new password. This link expires in 1 hour.
    </Text>
    <Section style={{ textAlign: 'center', margin: '24px 0' }}>
      <Button href={resetUrl} style={buttonStyle}>
        Reset Password
      </Button>
    </Section>
    <Text style={bodyTextStyle}>
      If you didn&apos;t request a password reset, you can safely ignore this email —
      your password will not be changed.
    </Text>
  </Layout>
);

export default PasswordResetEmail;
