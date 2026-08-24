import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ToastProvider,
  useToast,
  toast,
  setToastInstance,
} from '../ToastContext';

function TestConsumer() {
  const { showToast, success, error, warning, info } = useToast();
  return (
    <div>
      <button onClick={() => showToast('generic message')}>showToast</button>
      <button onClick={() => showToast('typed message', 'warning')}>showToastTyped</button>
      <button onClick={() => success('success message')}>success</button>
      <button onClick={() => error('error message')}>error</button>
      <button onClick={() => warning('warning message')}>warning</button>
      <button onClick={() => info('info message')}>info</button>
    </div>
  );
}

describe('ToastContext', () => {
  describe('useToast hook (must be used within a ToastProvider)', () => {
    it('throws when used outside of a ToastProvider', () => {
      // Suppress the expected React error boundary console noise.
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      function Broken() {
        useToast();
        return null;
      }

      expect(() => render(<Broken />)).toThrow(
        'useToast must be used within a ToastProvider'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('ToastProvider + useToast', () => {
    it('shows a toast via showToast with the default "info" type', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <TestConsumer />
        </ToastProvider>
      );

      await user.click(screen.getByText('showToast'));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('generic message');
    });

    it('shows a toast via showToast with an explicit type', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <TestConsumer />
        </ToastProvider>
      );

      await user.click(screen.getByText('showToastTyped'));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('typed message');
    });

    it('shows a success toast', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <TestConsumer />
        </ToastProvider>
      );

      await user.click(screen.getByText('success'));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('success message');
    });

    it('shows an error toast', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <TestConsumer />
        </ToastProvider>
      );

      await user.click(screen.getByText('error'));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('error message');
    });

    it('shows a warning toast', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <TestConsumer />
        </ToastProvider>
      );

      await user.click(screen.getByText('warning'));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('warning message');
    });

    it('shows an info toast', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <TestConsumer />
        </ToastProvider>
      );

      await user.click(screen.getByText('info'));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('info message');
    });

    it('closes the toast when the Toast component calls onClose', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <TestConsumer />
        </ToastProvider>
      );

      await user.click(screen.getByText('info'));
      await screen.findByRole('alert');

      await user.click(screen.getByRole('button', { name: /close notification/i }));

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
  });

  describe('singleton `toast` object', () => {
    afterEach(() => {
      // Ensure no stray instance leaks between tests.
      setToastInstance(null as any);
    });

    it('warns and does nothing for success/error/warning/info/showToast when uninitialized', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      toast.success('a');
      toast.error('b');
      toast.warning('c');
      toast.info('d');
      toast.showToast('e');

      expect(consoleSpy).toHaveBeenCalledTimes(5);
      expect(consoleSpy).toHaveBeenCalledWith('Toast instance not initialized');

      consoleSpy.mockRestore();
    });

    it('delegates to the registered instance once a ToastProvider has mounted', async () => {
      render(
        <ToastProvider>
          <div>content</div>
        </ToastProvider>
      );

      // Drive the module-level singleton directly (this is what api.ts's
      // interceptor uses outside of any React component).
      act(() => {
        toast.error('outside message');
      });

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('outside message');
    });

    it('delegates success/warning/info to the registered instance via the singleton', async () => {
      render(
        <ToastProvider>
          <div>content</div>
        </ToastProvider>
      );

      act(() => {
        toast.success('success via singleton');
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('success via singleton');

      act(() => {
        toast.warning('warning via singleton');
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('warning via singleton');

      act(() => {
        toast.info('info via singleton');
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('info via singleton');
    });

    it('calls showToast on the instance with an explicit type via the singleton', async () => {
      render(
        <ToastProvider>
          <div>content</div>
        </ToastProvider>
      );

      act(() => {
        toast.showToast('typed via singleton', 'warning');
      });

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('typed via singleton');
    });

    it('defaults to "info" when showToast is called via the singleton with no type', async () => {
      render(
        <ToastProvider>
          <div>content</div>
        </ToastProvider>
      );

      act(() => {
        toast.showToast('default type via singleton');
      });

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('default type via singleton');
    });

    it('falls back to warning once the ToastProvider unmounts (cleanup clears the instance)', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const { unmount } = render(
        <ToastProvider>
          <div>content</div>
        </ToastProvider>
      );

      unmount();

      toast.success('after unmount');

      expect(consoleSpy).toHaveBeenCalledWith('Toast instance not initialized');

      consoleSpy.mockRestore();
    });
  });
});
