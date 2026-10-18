/**
 * dsh-client-ui-history-nav — Host half.
 *
 * Nothing runs on the Host: this bundle is entirely a browser-side plugin. The
 * row exists so the bundle patch resolves to a real module and the bundle can be
 * switched on; the browser half is attached to that row through package.json
 * `dsh.client` and lives in lib/client.js.
 *
 * No imports on purpose: this file must stay resolvable without the profile's
 * module tree.
 */

export const name = 'dsh-client-ui-history-nav'

export function apply() {}
