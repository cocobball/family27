export function createEventBus() {
  const listeners = new Map();

  function on(event, handler) {
    const arr = listeners.get(event) ?? [];
    arr.push(handler);
    listeners.set(event, arr);
    return () => off(event, handler);
  }

  function off(event, handler) {
    const arr = listeners.get(event) ?? [];
    listeners.set(event, arr.filter((h) => h !== handler));
  }

  function emit(event, payload) {
    const arr = listeners.get(event) ?? [];
    for (const h of arr) {
      try { h(payload); } catch (e) { console.error(e); }
    }
  }

  return { on, off, emit };
}
