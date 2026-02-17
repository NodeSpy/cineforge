import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Import from './Import';
import importFixture from '../test/fixtures/import_tmdb_ids.json';
import looneyFixture from '../test/fixtures/looney_tunes_slice.json';

// Mock the entire API client module
vi.mock('../api/client', () => ({
  previewImport: vi.fn(),
  importMovies: vi.fn(),
  getJob: vi.fn(),
  getConfig: vi.fn(),
  getTags: vi.fn().mockResolvedValue([]),
}));

import { previewImport } from '../api/client';
import type { PreviewResponse } from '../api/client';

const mockPreviewResponse: PreviewResponse = {
  items: importFixture.map((item) => ({
    tmdb_id: item.tmdb_id,
    imdb_id: '',
    title: item.title,
    year: 1930,
    overview: 'A classic cartoon short',
    poster_url: '',
    status: 'ready' as const,
  })),
  total: importFixture.length,
  ready: importFixture.length,
};

function renderImport() {
  return render(
    <MemoryRouter>
      <Import />
    </MemoryRouter>,
  );
}

function createImportFile() {
  const content = JSON.stringify(importFixture);
  return new File([content], 'import_movies.json', { type: 'application/json' });
}

function createLooneyFile() {
  const content = JSON.stringify(looneyFixture);
  return new File([content], 'looney_tunes.json', { type: 'application/json' });
}

describe('Import page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transitions to preview step after successful file upload', async () => {
    const user = userEvent.setup();

    vi.mocked(previewImport).mockResolvedValue(mockPreviewResponse);

    renderImport();

    expect(screen.getByText(/drop a json file here/i)).toBeInTheDocument();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    await user.upload(fileInput, createImportFile());

    await waitFor(() => {
      expect(screen.getByText(/ready to import/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Start Over')).toBeInTheDocument();
    expect(screen.getByText(/Import \d+ Movies/)).toBeInTheDocument();

    for (const item of importFixture) {
      expect(screen.getByText(item.title)).toBeInTheDocument();
    }

    expect(previewImport).toHaveBeenCalledTimes(1);
    const [items] = vi.mocked(previewImport).mock.calls[0];
    expect(items).toHaveLength(importFixture.length);
    expect(items[0].tmdb_id).toBe(12345);
  });

  it('shows error for file with no valid TMDb or IMDb IDs', async () => {
    const user = userEvent.setup();

    renderImport();

    expect(screen.getByText(/drop a json file here/i)).toBeInTheDocument();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, createLooneyFile());

    await waitFor(() => {
      expect(
        screen.getByText(/no valid tmdb or imdb ids found/i),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('Start Over')).not.toBeInTheDocument();
    expect(screen.queryByText(/Import \d+ Movies/)).not.toBeInTheDocument();

    expect(previewImport).not.toHaveBeenCalled();
  });

  it('shows Export JSON button in preview step', async () => {
    const user = userEvent.setup();

    vi.mocked(previewImport).mockResolvedValue(mockPreviewResponse);

    renderImport();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, createImportFile());

    await waitFor(() => {
      expect(screen.getByText(/ready to import/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Export JSON')).toBeInTheDocument();
  });
});
