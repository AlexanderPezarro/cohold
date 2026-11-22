import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout, bodyTextStyle, buttonStyle, headingStyle } from './Layout.js';

interface InviteEmailProps {
  inviteUrl: string;
  invitedBy: string;
}

export const InviteEmail: React.FC<InviteEmailProps> = ({ inviteUrl, invitedBy }) => (
  <Layout previewText="You've been invited to Cohold">
    <Text style={headingStyle}>You&apos;ve been invited to Cohold</Text>
    <Text style={bodyTextStyle}>
      {invitedBy} has added you as a co-owner on Cohold. Choose a password to sign in. This link
      expires in 7 days.
    </Text>
    <Section style={{ textAlign: 'center', margin: '24px 0' }}>
      <Button href={inviteUrl} style={buttonStyle}>
        Choose a password
      </Button>
    </Section>
  </Layout>
);

export default InviteEmail;
