import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Convert from './Convert';
import fixture from '../test/fixtures/looney_tunes_slice.json';

// Mock the entire API client module
vi.mock('../api/client', () => ({
  convertTitlesStream: vi.fn(),
  resumeConvertStream: vi.fn(),
  importMovies: vi.fn(),
  listConversions: vi.fn(),
  getConversion: vi.fn(),
  getConfig: vi.fn(),
  updateConversionSelection: vi.fn(),
  deleteConversion: vi.fn(),
}));

import {
  convertTitlesStream,
  listConversions,
} from '../api/client';
import type { ConvertMatch, StreamCallbacks } from '../api/client';

const mockTmdbMovie = {
  id: 99999,
  title: 'Test Movie',
  original_title: 'Test Movie',
  overview: 'A test movie',
  release_date: '1930-01-01',
  poster_path: '/test.jpg',
  vote_average: 7.5,
};

function buildMatchResult(item: (typeof fixture)[0]): ConvertMatch {
  return {
    original_title: item.title,
    original_year: item.season,
    matches: [mockTmdbMovie],
    best_match: mockTmdbMovie,
    status: 'matched',
  };
}

function renderConvert() {
  return render(
    <MemoryRouter>
      <Convert />
    </MemoryRouter>,
  );
}

function createFixtureFile() {
  const content = JSON.stringify(fixture);
  return new File([content], 'looney_tunes_slice.json', { type: 'application/json' });
}

describe('Convert page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listConversions).mockResolvedValue([]);
  });

  it('transitions to review step after SSE stream completes', async () => {
    const user = userEvent.setup();

    vi.mocked(convertTitlesStream).mockImplementation(
      async (_items: Record<string, unknown>[], callbacks: StreamCallbacks) => {
        callbacks.onProgress?.(5, 'test-session-id');
        for (let i = 0; i < fixture.length; i++) {
          callbacks.onResult?.(i, buildMatchResult(fixture[i]));
        }
        callbacks.onDone?.(5, 5, 'test-session-id');
      },
    );

    renderConvert();

    await waitFor(() => {
      expect(screen.getByText(/drop a json file here/i)).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    await user.upload(fileInput, createFixtureFile());

    await waitFor(() => {
      expect(screen.getByText('Start Over')).toBeInTheDocument();
    });

    expect(screen.getByText(/titles selected/i)).toBeInTheDocument();
    expect(screen.getByText('Export JSON')).toBeInTheDocument();
    expect(screen.getByText(/Import \d+ Movies/)).toBeInTheDocument();

    expect(convertTitlesStream).toHaveBeenCalledTimes(1);
    const [items, , fileName] = vi.mocked(convertTitlesStream).mock.calls[0];
    expect(items).toHaveLength(5);
    expect(fileName).toBe('looney_tunes_slice.json');
  });

  it('stays on upload step and shows error if SSE stream errors', async () => {
    const user = userEvent.setup();

    vi.mocked(convertTitlesStream).mockImplementation(
      async (_items: Record<string, unknown>[], callbacks: StreamCallbacks) => {
        callbacks.onError?.('TMDb API key is not configured');
      },
    );

    renderConvert();

    await waitFor(() => {
      expect(screen.getByText(/drop a json file here/i)).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, createFixtureFile());

    await waitFor(() => {
      expect(screen.getByText('TMDb API key is not configured')).toBeInTheDocument();
    });

    const uploadInput = document.querySelector('input[type="file"]');
    expect(uploadInput).toBeTruthy();

    expect(screen.queryByText('Start Over')).not.toBeInTheDocument();
    expect(screen.queryByText('Export JSON')).not.toBeInTheDocument();
  });

  it('shows matching progress during stream', async () => {
    const user = userEvent.setup();

    let resolveStream!: () => void;
    const streamPromise = new Promise<void>((resolve) => {
      resolveStream = resolve;
    });

    vi.mocked(convertTitlesStream).mockImplementation(
      async (_items: Record<string, unknown>[], callbacks: StreamCallbacks) => {
        callbacks.onProgress?.(5, 'test-session-id');
        callbacks.onResult?.(0, buildMatchResult(fixture[0]));
        callbacks.onResult?.(1, buildMatchResult(fixture[1]));
        await streamPromise;
        callbacks.onResult?.(2, buildMatchResult(fixture[2]));
        callbacks.onResult?.(3, buildMatchResult(fixture[3]));
        callbacks.onResult?.(4, buildMatchResult(fixture[4]));
        callbacks.onDone?.(5, 5, 'test-session-id');
      },
    );

    renderConvert();

    await waitFor(() => {
      expect(screen.getByText(/drop a json file here/i)).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, createFixtureFile());

    await waitFor(() => {
      expect(screen.getByText('Live Results')).toBeInTheDocument();
    });

    expect(screen.getByText(/2 of 5 processed/)).toBeInTheDocument();

    expect(screen.queryByText('Start Over')).not.toBeInTheDocument();

    resolveStream();

    await waitFor(() => {
      expect(screen.getByText('Start Over')).toBeInTheDocument();
    });
  });
});
