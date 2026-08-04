import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

const colors = {
  background: '#faf8f5',
  primary: '#1a3d2b',
  text: '#1c1917',
  muted: '#6b7280',
};

interface LayoutProps {
  previewText: string;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ previewText, children }) => (
  <Html>
    <Head />
    <Preview>{previewText}</Preview>
    <Body style={bodyStyle}>
      <Container style={containerStyle}>
        <Section style={{ textAlign: 'center', marginBottom: '24px' }}>
          <Img
            src={`${clientUrl}/logo-mark.png`}
            width="48"
            height="32"
            alt="Cohold"
          />
        </Section>
        {children}
        <Hr style={hrStyle} />
        <Text style={footerStyle}>
          Cohold &middot; Co-own property. Split everything fairly.
        </Text>
      </Container>
    </Body>
  </Html>
);

const bodyStyle: React.CSSProperties = {
  backgroundColor: colors.background,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  margin: 0,
  padding: '32px 0',
};

const containerStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  margin: '0 auto',
  maxWidth: '480px',
  padding: '32px',
};

const hrStyle: React.CSSProperties = {
  borderColor: '#e5e0d8',
  margin: '32px 0 16px',
};

const footerStyle: React.CSSProperties = {
  color: colors.muted,
  fontSize: '12px',
  textAlign: 'center',
};

export const headingStyle: React.CSSProperties = {
  color: colors.primary,
  fontSize: '20px',
  fontWeight: 700,
  margin: '0 0 16px',
};

export const bodyTextStyle: React.CSSProperties = {
  color: colors.text,
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 16px',
};

export const buttonStyle: React.CSSProperties = {
  backgroundColor: colors.primary,
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: 600,
  padding: '12px 24px',
  textDecoration: 'none',
};
