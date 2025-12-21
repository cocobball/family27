export function createSharedState(initial = {}) {
  let state = { ...initial };
  const subs = new Set();

  function get() { return state; }

  function set(partial) {
    state = { ...state, ...partial };
    for (const fn of subs) fn(state);
  }

  function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  return { get, set, subscribe };
}
