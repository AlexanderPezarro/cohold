import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toast } from '../Toast';

describe('Toast', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <Toast message="Hello" severity="info" open={false} onClose={jest.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the message and role=alert when open', () => {
    render(<Toast message="Saved successfully" severity="success" open onClose={jest.fn()} />);

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();
  });

  it.each([
    ['success' as const],
    ['error' as const],
    ['warning' as const],
    ['info' as const],
  ])('renders the correct icon container for severity=%s', (severity) => {
    render(<Toast message="msg" severity={severity} open onClose={jest.fn()} />);

    const alert = screen.getByRole('alert');
    expect(alert.className).toContain(severity);
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<Toast message="msg" severity="info" open onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close notification/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('auto-hides after the default duration', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    render(<Toast message="msg" severity="info" open onClose={onClose} />);

    expect(onClose).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);

    expect(onClose).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('auto-hides after a custom autoHideDuration', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    render(
      <Toast message="msg" severity="info" open onClose={onClose} autoHideDuration={2000} />
    );

    jest.advanceTimersByTime(1999);
    expect(onClose).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('does not schedule a timer when open is false', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    render(<Toast message="msg" severity="info" open={false} onClose={onClose} />);

    jest.advanceTimersByTime(10000);
    expect(onClose).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('clears the previous timer when re-rendered with a new autoHideDuration', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const { rerender } = render(
      <Toast message="msg" severity="info" open onClose={onClose} autoHideDuration={5000} />
    );

    jest.advanceTimersByTime(1000);
    rerender(
      <Toast message="msg" severity="info" open onClose={onClose} autoHideDuration={10000} />
    );

    // Original 5000ms timer should have been cleared; only the new 10000ms one fires.
    jest.advanceTimersByTime(9000);
    expect(onClose).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    expect(onClose).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
