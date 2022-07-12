import immutable from 'immutable';

// Same idea, and very similar implementation, to `pick` from lodash.
function pick(object, keys=undefined) {
  if (keys === undefined) {
    return object;
  }
  return keys.reduce(function (picked, key) {
    picked[key] = object[key]
    return picked;
  }, {});
}

// This is very similar to `defaultTo` from lodash, but it only considers
// whether `current` is `undefined`.
function undefined_default(current, fallback) {
  return (
    current === undefined
    ? fallback
    : current
  );
}

// Obtain a list of up to one sentinel element from each list in `collections`
// such that that element is as close to the head of the list as possible while
// also not being the sentinel of an earlier list.  Also obtain a set of all
// the elements of all the lists in `collections` that are not the sentinels of
// any of these lists.  These two results are returned as a
// { sentinels, remainder } object.  (TODO: interface is already out-of-date!)
function separate_sentinels(collections, result=undefined)
{
  if (collections === undefined) {
    collections = {};
  }
  if (result === undefined) {
    collections = immutable.fromJS(collections);
    result = {
      sentinels: immutable.List(),
      sentinel_ordering: immutable.Map(),
      remainder: immutable.OrderedSet(),
    };
  }
  if (collections.isEmpty()) {
    return result;
  }
  const current_elements = collections.first();
  const sentinel_index = current_elements.findIndex(function (element) {
    return element !== undefined && !result.sentinel_ordering.has(element);
  });
  if (sentinel_index > -1) {
    const sentinel = current_elements.get(sentinel_index);
    result.sentinel_ordering = result.sentinel_ordering.set(
      sentinel,
      result.sentinels.size,
    );
    result.sentinels = result.sentinels.push(sentinel);
  } else {
    // Empty lists or lists of entirely sentinels of earlier lists will have an
    // intentionally `undefined` sentinel.
    result.sentinels = result.sentinels.push(undefined);
  }
  result.remainder = result.remainder
    .union(current_elements)
    .subtract(immutable.Set.fromKeys(result.sentinel_ordering));
  return separate_sentinels(collections.shift(), result);
}

// `keymap`, here, is an array of tuples where the element 0 is the original
// key and the element 1 is the new key.
function rekey(object, keymap, keep_missing=true) {
  return keymap.reduce(function (result, pair) {
    const [ original_key, new_key ] = pair;
    result[new_key] = object[original_key];
    // This only matters when `keep_missing` is true:
    delete result[original_key];
    return result;
  }, (
    keep_missing
    ? object
    : {}
  ));
}

export {
  pick,
  undefined_default,
  separate_sentinels,
  rekey,
};
