# Optional code hygiene pack

This is an opt-in reference integration, not the default Veritas policy.
See the [code hygiene guide](../../docs/guides/code-hygiene.md) for configuration,
rollout, evidence limitations and standards interoperability.

`oxlint.json` loads the adjacent plugin. Keep the directory together when copying
it into your repository. `repo-standards.json` supplies the linked requirement;
add a `code-hygiene` Evidence Check that runs the detector. The plugin is tooling,
not imported by the Veritas evaluation engine. Consumers install their own Oxlint;
Veritas's development dependency exercises the pack with Oxlint 1.88.0.

The suppression, comment and namespace-import rules are adapted from
[T3 Code at 680152e27b2a961686389ca69a1557cbb2c55f08](https://github.com/pingdotgg/t3code/tree/680152e27b2a961686389ca69a1557cbb2c55f08/oxlint-plugin-t3code).
Type annotations and the identity `defineRule` wrapper were removed for plain
ESM loading. [LICENSE-T3](LICENSE-T3) retains the original MIT notice.
The deterministic-unit-tests rule is a smaller framework-independent example,
not a port of T3's Effect-aware timing analysis.

Required controls should demonstrate catches and benign examples first. Start
subjective comment guidance at warning level. Never claim this pack detects
all timing patterns, validates the truth of suppression reasons, or reproduces
T3's complete lint configuration.
