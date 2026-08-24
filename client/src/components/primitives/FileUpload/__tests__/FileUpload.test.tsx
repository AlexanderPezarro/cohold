import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileUpload } from '../FileUpload';

function makeFile(name: string, size: number, type = 'text/plain'): File {
  const file = new File([new Uint8Array(size)], name, { type });
  // jsdom computes `size` from the blob parts, so this already matches `size`,
  // but we set it explicitly to be robust to jsdom implementation differences.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('FileUpload', () => {
  it('renders the drop zone with default prompt text', () => {
    render(<FileUpload onFilesChange={jest.fn()} />);

    expect(
      screen.getByText('Drag & drop files here, or click to browse')
    ).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'false');
  });

  it('shows the accepted-types hint when accept is provided', () => {
    render(<FileUpload onFilesChange={jest.fn()} accept="image/png,image/jpeg" />);

    expect(screen.getByText('Accepted: image/png,image/jpeg')).toBeInTheDocument();
  });

  it('does not show the accepted-types hint when accept is omitted', () => {
    render(<FileUpload onFilesChange={jest.fn()} />);

    expect(screen.queryByText(/Accepted:/)).not.toBeInTheDocument();
  });

  it('opens the file picker when the drop zone is clicked', async () => {
    const user = userEvent.setup();
    render(<FileUpload onFilesChange={jest.fn()} />);

    const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
    await user.click(screen.getByRole('button'));

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('opens the file picker on Enter key press', () => {
    render(<FileUpload onFilesChange={jest.fn()} />);

    const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('opens the file picker on Space key press', () => {
    render(<FileUpload onFilesChange={jest.fn()} />);

    const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('does not open the file picker via keyboard for other keys', () => {
    render(<FileUpload onFilesChange={jest.fn()} />);

    const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Tab' });

    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('does not open the file picker when disabled', async () => {
    const user = userEvent.setup();
    render(<FileUpload onFilesChange={jest.fn()} disabled />);

    const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
    await user.click(screen.getByRole('button'));

    expect(clickSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button')).toHaveAttribute('tabIndex', '-1');
    clickSpy.mockRestore();
  });

  it('selects a single file through the hidden input and reports it', () => {
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} />);

    const file = makeFile('report.pdf', 2048);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    expect(onFilesChange).toHaveBeenCalledWith([file]);
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('resets the input value after selection so the same file can be reselected', () => {
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} />);

    const file = makeFile('report.pdf', 100);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    expect(input.value).toBe('');
  });

  it('does nothing when the input change event has no files', () => {
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });

    expect(onFilesChange).not.toHaveBeenCalled();
  });

  it('does nothing when the input change event has a null FileList', () => {
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: null } });

    expect(onFilesChange).not.toHaveBeenCalled();
  });

  it('replaces the previous file when multiple is false and a new file is chosen', () => {
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    const first = makeFile('first.txt', 10);
    fireEvent.change(input, { target: { files: [first] } });
    expect(onFilesChange).toHaveBeenLastCalledWith([first]);

    const second = makeFile('second.txt', 20);
    fireEvent.change(input, { target: { files: [second] } });

    expect(onFilesChange).toHaveBeenLastCalledWith([second]);
    expect(screen.queryByText('first.txt')).not.toBeInTheDocument();
    expect(screen.getByText('second.txt')).toBeInTheDocument();
  });

  it('accumulates files when multiple is true', () => {
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} multiple />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    const first = makeFile('first.txt', 10);
    fireEvent.change(input, { target: { files: [first] } });

    const second = makeFile('second.txt', 20);
    fireEvent.change(input, { target: { files: [second] } });

    expect(onFilesChange).toHaveBeenLastCalledWith([first, second]);
    expect(screen.getByText('first.txt')).toBeInTheDocument();
    expect(screen.getByText('second.txt')).toBeInTheDocument();
  });

  it('formats byte-scale file sizes', () => {
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('tiny.txt', 512)] } });

    expect(screen.getByText('512 B')).toBeInTheDocument();
  });

  it('formats megabyte-scale file sizes', () => {
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('big.zip', 5 * 1024 * 1024)] } });

    expect(screen.getByText('5.0 MB')).toBeInTheDocument();
  });

  it('rejects a file that exceeds maxSize and does not call onFilesChange', () => {
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} maxSize={1024} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const oversized = makeFile('huge.bin', 2048);
    fireEvent.change(input, { target: { files: [oversized] } });

    expect(onFilesChange).not.toHaveBeenCalled();
    expect(
      screen.getByText('File "huge.bin" exceeds the maximum size of 1.0 KB.')
    ).toBeInTheDocument();
  });

  it('clears a previous error once a valid file is chosen', () => {
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} maxSize={1024} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('huge.bin', 2048)] } });
    expect(screen.getByText(/exceeds the maximum size/)).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [makeFile('ok.bin', 100)] } });

    expect(screen.queryByText(/exceeds the maximum size/)).not.toBeInTheDocument();
    expect(onFilesChange).toHaveBeenCalledWith([makeFile('ok.bin', 100)]);
  });

  it('removes a file and clears the file list entry when the remove button is clicked', async () => {
    const user = userEvent.setup();
    const onFilesChange = jest.fn();
    render(<FileUpload onFilesChange={onFilesChange} multiple />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('keep.txt', 10), makeFile('drop.txt', 10)] } });

    await user.click(screen.getByRole('button', { name: 'Remove drop.txt' }));

    expect(onFilesChange).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'keep.txt' })]);
    expect(screen.queryByText('drop.txt')).not.toBeInTheDocument();
    expect(screen.getByText('keep.txt')).toBeInTheDocument();
  });

  it('disables remove buttons when the upload zone is disabled', () => {
    const onFilesChange = jest.fn();
    const { rerender } = render(<FileUpload onFilesChange={onFilesChange} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('a.txt', 10)] } });

    rerender(<FileUpload onFilesChange={onFilesChange} disabled />);

    expect(screen.getByRole('button', { name: 'Remove a.txt' })).toBeDisabled();
  });

  it('does not render a file list when no files have been chosen', () => {
    render(<FileUpload onFilesChange={jest.fn()} />);

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  describe('drag and drop', () => {
    it('sets drag-over state on dragOver and dragEnter, and clears it on dragLeave', () => {
      render(<FileUpload onFilesChange={jest.fn()} />);
      const zone = screen.getByRole('button');

      fireEvent.dragOver(zone);
      expect(zone.className).toContain('dragOver');

      fireEvent.dragLeave(zone);
      expect(zone.className).not.toContain('dragOver');

      fireEvent.dragEnter(zone);
      expect(zone.className).toContain('dragOver');
    });

    it('does not set drag-over state while disabled', () => {
      render(<FileUpload onFilesChange={jest.fn()} disabled />);
      const zone = screen.getByRole('button');

      fireEvent.dragOver(zone);
      expect(zone.className).not.toContain('dragOver');

      fireEvent.dragEnter(zone);
      expect(zone.className).not.toContain('dragOver');
    });

    it('adds dropped files and clears drag-over state', () => {
      const onFilesChange = jest.fn();
      render(<FileUpload onFilesChange={onFilesChange} />);
      const zone = screen.getByRole('button');
      const file = makeFile('dropped.txt', 10);

      fireEvent.dragOver(zone);
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });

      expect(onFilesChange).toHaveBeenCalledWith([file]);
      expect(zone.className).not.toContain('dragOver');
      expect(screen.getByText('dropped.txt')).toBeInTheDocument();
    });

    it('ignores a drop with no files', () => {
      const onFilesChange = jest.fn();
      render(<FileUpload onFilesChange={onFilesChange} />);
      const zone = screen.getByRole('button');

      fireEvent.drop(zone, { dataTransfer: { files: [] } });

      expect(onFilesChange).not.toHaveBeenCalled();
    });

    it('ignores a drop while disabled', () => {
      const onFilesChange = jest.fn();
      render(<FileUpload onFilesChange={onFilesChange} disabled />);
      const zone = screen.getByRole('button');
      const file = makeFile('dropped.txt', 10);

      fireEvent.drop(zone, { dataTransfer: { files: [file] } });

      expect(onFilesChange).not.toHaveBeenCalled();
    });
  });
});
