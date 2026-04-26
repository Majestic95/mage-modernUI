import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { App } from './App';

describe('App scaffold', () => {
  it('renders the project name', () => {
    render(<App />);
    // Heading is split across spans (Mage / Modern UI). Match the
    // distinctive accent half so we don't depend on exact composition.
    expect(screen.getByText(/Modern UI/)).toBeInTheDocument();
  });

  it('shows the backend URL hint', () => {
    render(<App />);
    expect(screen.getByText(/localhost:18080/)).toBeInTheDocument();
  });
});
