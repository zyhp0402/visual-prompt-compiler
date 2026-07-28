import { describe, expect, it } from 'vitest';

import { previewSizeForAspectRatio } from '../src/SidePanel.js';

describe('image preview size', () => {
  it.each([
    ['2:1', '1536x1024'],
    ['1:2', '1024x1536'],
    ['1:1', '1024x1024'],
    ['invalid', '1024x1024'],
  ] as const)('maps %s to %s', (ratio, expected) => {
    expect(previewSizeForAspectRatio(ratio)).toBe(expected);
  });
});
