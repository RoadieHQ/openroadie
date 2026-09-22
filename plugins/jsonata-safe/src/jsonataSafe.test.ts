import { jsonataSafe } from './jsonataSafe';

describe('jsonataSafe', () => {
  describe('default behavior (safe builtins only)', () => {
    it('should block $eval by default', () => {
      expect(() => jsonataSafe('$eval("1 + 2")')).toThrow(
        'disallowed function: eval',
      );
    });

    it('should block dynamic function calls by default', () => {
      expect(() => jsonataSafe('($fn := $lowercase; $fn("test"))')).toThrow(
        'disallowed function: fn',
      );
    });

    it('should allow arithmetic expressions', () => {
      const expr = jsonataSafe('price * quantity');
      expect(expr).toBeDefined();
    });

    it('should allow filter expressions', () => {
      const expr = jsonataSafe('items[price > 10]');
      expect(expr).toBeDefined();
    });
  });

  describe('expression evaluation', () => {
    it('should evaluate simple path expression', async () => {
      const expr = jsonataSafe('foo.bar');
      const result = await expr.evaluate({ foo: { bar: 'hello' } });
      expect(result).toBe('hello');
    });

    it('should evaluate $lowercase expression', async () => {
      const expr = jsonataSafe('$lowercase(name)');
      const result = await expr.evaluate({ name: 'HELLO' });
      expect(result).toBe('hello');
    });

    it('should evaluate $sum expression', async () => {
      const expr = jsonataSafe('$sum(values)');
      const result = await expr.evaluate({ values: [1, 2, 3] });
      expect(result).toBe(6);
    });

    it('should evaluate lambda expression', async () => {
      const expr = jsonataSafe('$map([1,2,3], function($v) { $v * 2 })');
      const result = await expr.evaluate({});
      expect([...result]).toEqual([2, 4, 6]);
    });
  });

  describe('with extra allowedFunctions', () => {
    it('should allow extra functions on top of builtins', () => {
      const expr = jsonataSafe('$custom(name)', {
        allowedFunctions: ['custom'],
      });
      expect(expr).toBeDefined();
    });

    it('should still allow builtins when extra functions are provided', () => {
      const expr = jsonataSafe('$sum([1, 2, 3])', {
        allowedFunctions: ['custom'],
      });
      expect(expr).toBeDefined();
    });

    it('should still block $eval even with extra functions', () => {
      expect(() =>
        jsonataSafe('$eval("1 + 2")', {
          allowedFunctions: ['custom'],
        }),
      ).toThrow('disallowed function: eval');
    });

    it('should block functions not in builtins or extras', () => {
      expect(() =>
        jsonataSafe('$dangerous(1)', {
          allowedFunctions: ['custom'],
        }),
      ).toThrow('disallowed function: dangerous');
    });

    it('should block dynamic function calls', () => {
      expect(() =>
        jsonataSafe('($fn := $lowercase; $fn("test"))', {
          allowedFunctions: ['custom'],
        }),
      ).toThrow('disallowed function: fn');
    });
  });

  describe('with allowLambdas disabled', () => {
    it('should throw for lambda expressions with the violation in the message', () => {
      expect(() =>
        jsonataSafe('$map([1,2,3], function($v) { $v * 2 })', {
          allowLambdas: false,
        }),
      ).toThrow(/Failed to validate jsonata.*lambda-not-allowed/s);
    });

    it('should allow non-lambda expressions', () => {
      const expr = jsonataSafe('$sum([1, 2, 3])', { allowLambdas: false });
      expect(expr).toBeDefined();
    });
  });

  describe('combined options', () => {
    it('should enforce both whitelist and lambda restriction', () => {
      expect(() =>
        jsonataSafe('$map([1,2,3], function($v) { $v * 2 })', {
          allowedFunctions: ['map'],
          allowLambdas: false,
        }),
      ).toThrow('lambda-not-allowed');
    });

    it('should allow expression matching both constraints', () => {
      const expr = jsonataSafe('$lowercase($trim(name))', {
        allowedFunctions: ['lowercase', 'trim'],
        allowLambdas: false,
      });
      expect(expr).toBeDefined();
    });
  });

  describe('invalid jsonata syntax', () => {
    it('should throw for invalid syntax', () => {
      expect(() => jsonataSafe('{')).toThrow();
    });
  });

  describe('$parseYaml', () => {
    it('should parse single YAML document', async () => {
      const expr = jsonataSafe('$parseYaml(content)');
      const result = await expr.evaluate({ content: 'name: test\nvalue: 123' });
      expect(result).toEqual([{ name: 'test', value: 123 }]);
    });

    it('should parse multi-document YAML', async () => {
      const yaml = `name: first
---
name: second`;
      const expr = jsonataSafe('$parseYaml(content)');
      const result = await expr.evaluate({ content: yaml });
      expect(result).toEqual([{ name: 'first' }, { name: 'second' }]);
    });

    it('should decode base64 and parse multi-document YAML', async () => {
      const multiYaml = `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: component-one
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: component-two`;
      const base64Content = Buffer.from(multiYaml).toString('base64');

      const expr = jsonataSafe('$parseYaml($base64decode(content))');
      const item = {
        encoding: 'base64',
        content: base64Content,
        name: 'catalog-info.yaml',
      };

      const result = await expr.evaluate(item);

      expect(result).toEqual([
        {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Component',
          metadata: { name: 'component-one' },
        },
        {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Component',
          metadata: { name: 'component-two' },
        },
      ]);
    });

    it('should reject YAML exceeding size limit', async () => {
      const oversizedContent = 'a'.repeat(1_000_001);
      const expr = jsonataSafe('$parseYaml(content)');
      await expect(
        expr.evaluate({ content: oversizedContent }),
      ).rejects.toThrow('YAML input exceeds maximum size');
    });

    it('should reject YAML with excessive aliases', async () => {
      const aliases = Array.from({ length: 51 }, (_, i) => `a${i}: *x`).join(
        '\n',
      );
      const yamlWithManyAliases = `x: &x value\n${aliases}`;
      const expr = jsonataSafe('$parseYaml(content)');
      await expect(
        expr.evaluate({ content: yamlWithManyAliases }),
      ).rejects.toThrow();
    });
  });
});
