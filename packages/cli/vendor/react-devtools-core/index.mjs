// Ink optionally loads React DevTools only when DEV=true. The browser-oriented
// package is not needed in a pure Node CLI, so provide a no-op implementation.
const noop = () => {};
export const initialize = noop;
export const connectToDevTools = noop;
export default {
  initialize: noop,
  connectToDevTools: noop,
};
