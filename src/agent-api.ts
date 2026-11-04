/**
 * Public agent API (`jank.js/agent`): `window.jank`, for scripts and agents to record a host and
 * read a short report. Importing this module does not access the DOM. The report may still change.
 */
export { installAgentApi } from "./agent/api.ts";
