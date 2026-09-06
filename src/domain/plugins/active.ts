import {aggregatePlugins, type LanguagePack} from "./aggregate";
import {BUILTIN_PLUGINS} from "./registry";

// Process-wide "active" LanguagePack - derived from currently enabled
// plugins. Domain functions accept an optional `pack` parameter and fall
// back to this default when none is passed. AppState calls
// `setActiveLanguagePack()` on every settings reload so the default reflects
// the live admin configuration without threading the pack through every
// call site.
//
// On startup (and in unit tests that don't initialize AppState), the default
// is the aggregate of all plugins that have `defaultEnabled = true`. This
// preserves byte-identical behavior with 1.x out of the box.
let active: LanguagePack = aggregatePlugins(
    BUILTIN_PLUGINS.filter((p) => p.defaultEnabled),
);

export function getActiveLanguagePack(): LanguagePack {
    return active;
}

export function setActiveLanguagePack(pack: LanguagePack): void {
    active = pack;
}
