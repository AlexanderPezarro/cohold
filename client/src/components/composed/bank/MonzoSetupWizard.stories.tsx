import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { MonzoSetupWizard } from './MonzoSetupWizard';
import type { MonzoSettingsResponse } from '../../../services/api/bank.service';

const emptySettings: MonzoSettingsResponse = {
  clientId: '',
  redirectUri: '',
  webhookBaseUrl: '',
  hasClientSecret: false,
  configured: false,
  source: 'none',
  suggested: {
    redirectUri: 'https://cohold.example.test/api/bank/monzo/callback',
    webhookBaseUrl: 'https://cohold.example.test',
  },
  hasBankAccounts: false,
};

const configuredSettings: MonzoSettingsResponse = {
  ...emptySettings,
  clientId: 'oauth2client_000012345',
  redirectUri: 'https://cohold.example.test/api/bank/monzo/callback',
  webhookBaseUrl: 'https://cohold.example.test',
  hasClientSecret: true,
  configured: true,
  source: 'db',
};

const meta: Meta<typeof MonzoSetupWizard> = {
  title: 'Composed/Bank/MonzoSetupWizard',
  component: MonzoSetupWizard,
  args: {
    open: true,
    onClose: fn(),
    onSaved: fn(),
    initialSettings: emptySettings,
    onSave: async () => configuredSettings,
  },
};

export default meta;

type Story = StoryObj<typeof MonzoSetupWizard>;

export const Step1Intro: Story = {
  args: { initialStep: 1 },
};

export const Step2ClientValues: Story = {
  args: { initialStep: 2 },
};

export const Step3Credentials: Story = {
  args: { initialStep: 3 },
};

export const Step3EditExisting: Story = {
  args: { initialSettings: configuredSettings },
};

export const ValidationErrors: Story = {
  args: { initialStep: 3 },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(await body.findByLabelText('Client ID'), 'not-a-client');
    await userEvent.click(await body.findByRole('button', { name: 'Next' }));
    await expect(
      await body.findByText('Client ID must start with "oauth2client_"')
    ).toBeInTheDocument();
    await expect(await body.findByText('Client secret is required')).toBeInTheDocument();
  },
};

export const ChangeClientIdWarning: Story = {
  args: {
    initialSettings: { ...configuredSettings, hasBankAccounts: true },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const clientId = await body.findByLabelText('Client ID');
    await userEvent.clear(clientId);
    await userEvent.type(clientId, 'oauth2client_000099999');
    await userEvent.click(await body.findByRole('button', { name: 'Next' }));
    await expect(await body.findByText(/will need to be reconnected/)).toBeInTheDocument();
  },
};

export const SaveError: Story = {
  args: {
    initialSettings: configuredSettings,
    onSave: async () => {
      throw new Error('Failed to save Monzo settings');
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('button', { name: 'Next' }));
    await userEvent.click(await body.findByRole('button', { name: 'Save and connect' }));
    await expect(await body.findByText('Failed to save Monzo settings')).toBeInTheDocument();
  },
};
