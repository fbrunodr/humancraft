// The game's version, vX.Y (a release is the git tag of that name).
//
// X, the rules' version: raised when the map, the rules or the shape of
// the game's state change, so that a game saved before would play
// differently or not at all. A save loads under its own X and no other.
// test/golden.test.ts holds this: it fails when X should have been raised.
//
// Y, the release under those rules: raised with every release that leaves
// X as it is (looks, the interface, how the computer plays, fixes). Any
// release of an X loads every save of that X; the latest is the one to
// use. Back to 0 when X is raised.
//
// A saved game says both (save.ts), so whoever serves the game knows which
// to fetch for it: the latest release of its X.
export const RULES_VERSION = 0;
export const RELEASE = 3;
export const VERSION = `v${RULES_VERSION}.${RELEASE}`;
