import { pick, undefined_default, separate_sentinels } from '../src/util.js';

describe('the `pick` function', function () {
  const ob = {
    a: '1',
    b: '2',
    c: '3',
  };

  it('returns an object with the correct keys picked', function () {
    expect(pick(ob, ['a', 'c'])).toEqual({
      a: '1',
      c: '3',
    });
  });

  it('returns the whole object if no keys are specified', function () {
    expect(pick(ob)).toEqual(ob);
  });
});

describe('the `undefined_default` function', function () {
  const defined_variable = 'value 1';
  const undefined_variable = undefined;

  it('returns the original value when it is not `undefined`', function () {
    expect(undefined_default(defined_variable, 'value 2')).toEqual('value 1');
  });

  it('returns the default value when the original is `undefined`', function () {
    expect(undefined_default(undefined_variable, 'value 2')).toEqual('value 2');
  });
});

describe('the `separate_sentinels` function', function () {
  const collections = [
    ['a', 'b'],
    ['c', 'd'],
    ['a', 'e', 'f'],
  ];

  it('identifies sentinels', function () {
    const result = separate_sentinels(collections);
    expect(result.sentinels.toArray()).toEqual(['a', 'c', 'e']);
    expect(result.sentinel_ordering.get('e')).toBe(2);
  });

  it('collects the correct remainder', function () {
    const result = separate_sentinels(collections);
    expect(result.remainder.toArray()).toEqual(['b', 'd', 'f']);
    expect(result.sentinel_ordering.get('b')).toBe(undefined);
  });

  it('ignores `undefined` elements', function () {
    const collections = [
      [undefined],
      [undefined, 'a'],
      ['b', 'c'],
      ['b', undefined, 'd'],
    ];
    const result = separate_sentinels(collections);
    // An `undefined` sentinel at an index means that the corresponding
    // collection *does not have* a sentinel:
    expect(result.sentinels.toArray()).toEqual([undefined, 'a', 'b', 'd']);
    // An `undefined` member of the `remainder` set indicates that there was an
    // element of a collection that had the value `undefined` (which, by
    // specification, cannot be a sentinel):
    expect(result.remainder.toArray()).toEqual([undefined, 'c']);
  });

  it('works on small cases', function () {
    const empty_collections = [];
    let result = separate_sentinels(empty_collections);
    expect(result.sentinels.size).toBe(0);
    expect(result.sentinel_ordering.size).toBe(0);
    expect(result.remainder.size).toBe(0);

    const singleton_collections = [['a']];
    result = separate_sentinels(singleton_collections);
    expect(result.sentinels.toArray()).toEqual(['a']);
    expect(result.sentinel_ordering.get('a')).toBe(0);
    expect(result.remainder.size).toBe(0);

    const empty_collection_collections = [[]];
    result = separate_sentinels(empty_collection_collections);
    expect(result.sentinels.toArray()).toEqual([undefined]);
    expect(result.sentinel_ordering.size).toBe(0);
    expect(result.remainder.size).toBe(0);
  });

  it('reports an `undefined` sentinel for an empty collection', function () {
    const collections = [
      ['a'],
      [],
      ['b'],
    ];
    const result = separate_sentinels(collections);
    expect(result.sentinels.toArray()).toEqual(['a', undefined, 'b']);
  });

  it('reports an `undefined` sentinel for covered collections', function () {
    const collections = [
      ['a'],
      ['b'],
      ['a', 'b'],
    ];
    const result = separate_sentinels(collections);
    expect(result.sentinels.toArray()).toEqual(['a', 'b', undefined]);
  });
});
