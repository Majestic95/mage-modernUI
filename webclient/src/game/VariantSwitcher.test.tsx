import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VariantSwitcher } from './VariantSwitcher';

describe('VariantSwitcher', () => {
  it('renders one button per registered variant', () => {
    render(<VariantSwitcher current="current" onChange={() => {}} />);
    expect(screen.getByTestId('variant-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('variant-button-current')).toBeInTheDocument();
  });

  it('marks the current variant active via data-active', () => {
    render(<VariantSwitcher current="current" onChange={() => {}} />);
    const btn = screen.getByTestId('variant-button-current');
    expect(btn.dataset['active']).toBe('true');
  });

  it('fires onChange with the clicked variant', () => {
    const onChange = vi.fn();
    render(<VariantSwitcher current="current" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('variant-button-current'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('current');
  });
});
