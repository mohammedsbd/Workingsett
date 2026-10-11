import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_GC_CONFIG,
  GcConfig,
  hasSideEffects,
  snakeCaseToolName,
} from './gc-config';

describe('gc config', () => {
  it('should have the documented defaults', () => {
    expect(DEFAULT_GC_CONFIG).toEqual({
      minContextTokens: 8000,
      protectedTurns: 6,
      archiveMinTokens: 1500,
      archiveAfterTurns: 6,
      sideEffectTools: [],
      sideEffectPatterns: [
        'send_',
        'create_',
        'delete_',
        'update_',
        'pay',
        'refund',
      ],
    });
  });

  it.each([
    ['sendEmail', 'send_email'],
    ['Send-Email', 'send_email'],
    ['crm.updateDeal', 'crm_update_deal'],
    ['web_search', 'web_search'],
  ])('writes %s as %s', (name, snake) => {
    expect(snakeCaseToolName(name)).toBe(snake);
  });

  describe('hasSideEffects', () => {
    const config: GcConfig = {
      ...DEFAULT_GC_CONFIG,
      sideEffectTools: ['save_note', 'Book_Flight'],
    };

    it.each([
      ['send_reply', true],
      ['sendReply', true],
      ['gmail_send_email', true],
      ['create_ticket', true],
      ['delete_file', true],
      ['update_record', true],
      ['pay_invoice', true],
      ['process_payment', true],
      ['issue_refund', true],
      ['save_note', true],
      ['book_flight', true],
      ['web_search', false],
      ['fetch_page', false],
      ['resend', false],
      ['get_order', false],
      ['lookup_customer', false],
    ])('%s: %s', (name, expected) => {
      expect(hasSideEffects(name, config)).toBe(expected);
    });

    it('should ignore empty patterns', () => {
      expect(
        hasSideEffects('web_search', { ...config, sideEffectPatterns: [''] }),
      ).toBe(false);
    });
  });
});
