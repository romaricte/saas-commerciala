import { BadRequestException } from '@nestjs/common';
import { calculateQuoteLine, calculateQuoteTotals } from './quote-calculator';

describe('quote calculator', () => {
  it('applique remise puis taxe avec un arrondi monétaire déterministe', () => {
    const line = calculateQuoteLine({
      quantity: '2.5',
      unitPrice: '125000',
      discountRate: '10',
      taxRate: '18',
    });

    expect(line.subtotal.toFixed(2)).toBe('312500.00');
    expect(line.discountTotal.toFixed(2)).toBe('31250.00');
    expect(line.taxTotal.toFixed(2)).toBe('50625.00');
    expect(line.total.toFixed(2)).toBe('331875.00');
  });

  it('additionne les totaux déjà arrondis des lignes', () => {
    const first = calculateQuoteLine({
      quantity: '1',
      unitPrice: '10.005',
      discountRate: '0',
      taxRate: '0',
    });
    const second = calculateQuoteLine({
      quantity: '2',
      unitPrice: '5',
      discountRate: '0',
      taxRate: '0',
    });

    expect(calculateQuoteTotals([first, second]).total.toFixed(2)).toBe(
      '20.01',
    );
  });

  it('refuse une quantité nulle et un taux supérieur à 100', () => {
    expect(() =>
      calculateQuoteLine({
        quantity: '0',
        unitPrice: '10',
        discountRate: '0',
        taxRate: '0',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      calculateQuoteLine({
        quantity: '1',
        unitPrice: '10',
        discountRate: '101',
        taxRate: '0',
      }),
    ).toThrow(BadRequestException);
  });
});
