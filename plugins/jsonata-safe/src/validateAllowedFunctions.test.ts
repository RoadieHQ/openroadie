import jsonata from 'jsonata';
import { validateAllowedFunctions } from './validateAllowedFunctions';

describe('validateAllowedFunctions', () => {
  describe('default behavior (all allowed)', () => {
    it.each([
      '$sum([1, 2, 3])',
      '$eval("1 + 2")',
      '$map([1,2,3], function($v) { $v * 2 })',
      '($fn := $sum; $fn([1,2,3]))',
      'foo.bar',
      'price * quantity',
      'items[0].name',
      'items[price > 10]',
    ])('should allow %s by default', expression => {
      const expr = jsonata(expression);
      const result = validateAllowedFunctions(expr);
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('allowedFunctions whitelist', () => {
    it('should allow functions in the whitelist', () => {
      const expr = jsonata('$lowercase("HELLO")');
      const result = validateAllowedFunctions(expr, {
        allowedFunctions: ['lowercase'],
      });
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should reject functions not in the whitelist', () => {
      const expr = jsonata('$sum([1, 2, 3])');
      const result = validateAllowedFunctions(expr, {
        allowedFunctions: ['lowercase'],
      });
      expect(result.ok).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].reason).toContain('disallowed function: sum');
    });

    it('should allow multiple whitelisted functions', () => {
      const expr = jsonata('$lowercase($trim(name))');
      const result = validateAllowedFunctions(expr, {
        allowedFunctions: ['lowercase', 'trim'],
      });
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should reject expression with one allowed and one disallowed function', () => {
      const expr = jsonata('$lowercase(name) & $string(total)');
      const result = validateAllowedFunctions(expr, {
        allowedFunctions: ['lowercase'],
      });
      expect(result.ok).toBe(false);
      expect(result.violations).toHaveLength(1);
    });

    it('should reject variable function calls when whitelist is set', () => {
      const expr = jsonata('($fn := $sum; $fn([1,2,3]))');
      const result = validateAllowedFunctions(expr, {
        allowedFunctions: ['sum'],
      });
      expect(result.ok).toBe(false);
      expect(
        result.violations.some(v => v.reason.includes('disallowed function')),
      ).toBe(true);
    });
  });

  describe('allowLambdas option', () => {
    it('should reject lambdas when allowLambdas is false', () => {
      const expr = jsonata('$map([1,2,3], function($v) { $v * 2 })');
      const result = validateAllowedFunctions(expr, { allowLambdas: false });
      expect(result.ok).toBe(false);
      expect(
        result.violations.some(v => v.reason === 'lambda-not-allowed'),
      ).toBe(true);
    });

    it('should allow lambdas when allowLambdas is true', () => {
      const expr = jsonata('$map([1,2,3], function($v) { $v * 2 })');
      const result = validateAllowedFunctions(expr, { allowLambdas: true });
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should combine allowLambdas with allowedFunctions', () => {
      const expr = jsonata('$map([1,2,3], function($v) { $v * 2 })');
      const result = validateAllowedFunctions(expr, {
        allowedFunctions: ['map'],
        allowLambdas: false,
      });
      expect(result.ok).toBe(false);
      expect(
        result.violations.some(v => v.reason === 'lambda-not-allowed'),
      ).toBe(true);
    });
  });
});
